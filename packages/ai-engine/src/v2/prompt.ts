import type { PromptContext, BookingDraft, KnowledgeChunk } from './types';
import { formatDateHKYmd, getHKTJsWeekday, getHKTToday } from './date-utils';

const FAQ_MAX_ITEMS = 8;
const FAQ_ANSWER_MAX = 220;
const PACKAGE_BLOCK_MAX = 1200;
const MAX_TITLE_LEN = 48;

function trimText(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Short key for compact faq.<key> lines (deduped per chunk). */
function faqKeyFromQuestion(question: string, used: Set<string>): string {
  const q = question.replace(/^Q[：:\s]*/i, '').trim();
  let base = 'item';
  if (/痛|感覺|麻醉|唔舒服/.test(q)) base = 'pain';
  else if (/恢復|復原|泛紅|紅|腫|恢復期/.test(q)) base = 'recovery';
  else if (/維持|幾耐|多久|持續|個月/.test(q)) base = 'duration';
  else if (/價|費用|錢|收費/.test(q)) base = 'price';
  else if (/副作用|風險|安全/.test(q)) base = 'safety';
  else {
    const slug = q
      .slice(0, 20)
      .replace(/\s+/g, '_')
      .replace(/[^\w\u4e00-\u9fff]/g, '');
    if (slug.length >= 2) base = slug;
  }
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

function formatFaqCompact(
  items: Array<{ question: string; answer: string }>,
  effectDur: string | null,
): string[] {
  const used = new Set<string>();
  const lines: string[] = [];
  for (const f of items.slice(0, FAQ_MAX_ITEMS)) {
    const a = f.answer.replace(/^A[：:\s]*/i, '').trim();
    const key = faqKeyFromQuestion(f.question, used);
    if (
      effectDur &&
      key === 'duration' &&
      normalizeMaintenanceSig(a) &&
      normalizeMaintenanceSig(effectDur) &&
      normalizeMaintenanceSig(a) === normalizeMaintenanceSig(effectDur)
    ) {
      continue;
    }
    lines.push(`faq.${key}: ${trimText(a, FAQ_ANSWER_MAX)}`);
  }
  return lines;
}

/** Normalise maintenance window for conservative dedupe (digits + 個月), null if no clear pattern. */
function normalizeMaintenanceSig(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, '');
  const m = t.match(/(\d+)\s*[-–]\s*(\d+)\s*個月/);
  if (m) return `${m[1]}-${m[2]}月`;
  return null;
}

/** Effect duration from FAQ / 功效 (not 療程時長 session length). */
function extractKbEffectDurationLine(c: KnowledgeChunk): string | null {
  for (const f of c.faqItems ?? []) {
    const qa = `${f.question}\n${f.answer}`;
    if (!/維持|幾耐|多久|持續|個月/.test(qa)) continue;
    const a = f.answer.replace(/^A[：:\s]*/i, '').trim();
    if (/\d+\s*[-–]\s*\d+\s*個月|約\s*\d+|一般\s*[\d\-–]+\s*個月/.test(a)) {
      return trimText(a, 280);
    }
  }
  if (c.effect) {
    for (const line of c.effect.split('\n')) {
      const t = line.replace(/^[-•\s]+/, '').trim();
      if (/\d+\s*[-–]\s*\d+\s*個月/.test(t) || (/效果/.test(t) && /個月/.test(t))) {
        return trimText(t, 200);
      }
    }
  }
  return null;
}

function isLikelyPackageDoc(c: KnowledgeChunk): boolean {
  return (
    /套餐/.test(c.title) ||
    c.content.includes('【包含項目】') ||
    /\n包含：\s*\n-/.test(c.content)
  );
}

/** Preserve 包含 lists for 「包含咩」 (price-only summary hid these). */
function extractPackageIncludeBlock(content: string): string {
  const m1 = content.match(/【包含項目】[\s\S]*?(?=\n\n【|\n\n適合人群|\n\n注意：|\n\n有效期：|\n\n常見問題|$)/);
  if (m1) return trimBlockPreserveLines(m1[0], PACKAGE_BLOCK_MAX);
  const m2 = content.match(
    /包含：\s*\n([\s\S]*?)(?=\n\n適合人群|\n\n注意：|\n\n有效期：|\n\n常見問題|$)/,
  );
  if (m2) return trimBlockPreserveLines(`包含：\n${m2[1].trim()}`, PACKAGE_BLOCK_MAX);
  return '';
}

/** Bullet lines from package include block (compact). */
function compactIncludeBlock(raw: string): string[] {
  const lines = raw.split('\n').map((l) => l.replace(/^[-•\s]+/, '').trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    if (/^【|^包含：?$/u.test(line)) continue;
    out.push(`- ${trimText(line, 120)}`);
  }
  return out.slice(0, 24);
}

function normPrice(p: string | null | undefined): string {
  return String(p ?? '')
    .replace(/^HKD\s*/i, '')
    .replace(/^HK\$\s*/i, '')
    .trim();
}

/** Trim length without collapsing newlines (KB include blocks need line breaks). */
function trimBlockPreserveLines(text: string, max: number): string {
  const t = text.replace(/\r\n/g, '\n').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function formatKnowledgeChunks(
  chunks: KnowledgeChunk[],
  options: { defaultSuitableFor: string; defaultCaution: string } = {
    defaultSuitableFor: 'General customers',
    defaultCaution: 'Follow professional aftercare guidance',
  },
): string {
  if (chunks.length === 0) return 'No knowledge base available.';

  const firstClause = (text: string, max: number): string => {
    const clause = text.split(/[。.!；;，,]/)[0] ?? text;
    return trimText(clause, max);
  };

  const seenLines = new Set<string>();

  const pushUniq = (lines: string[], line: string) => {
    const k = line.replace(/\s+/g, ' ');
    if (seenLines.has(k)) return;
    seenLines.add(k);
    lines.push(line);
  };

  return chunks
    .map((c) => {
      seenLines.clear();

      if (c.title === '營業時間') {
        const lines: string[] = ['[GLOBAL]', `type: hours`];
        const head = trimText(c.content.replace(/\s+/g, ' '), 600);
        pushUniq(lines, `hours: ${head}`);
        return lines.join('\n');
      }

      const hasStructure =
        c.price ||
        c.duration ||
        c.effect ||
        c.suitable ||
        c.unsuitable ||
        c.faqItems?.length;
      if (!hasStructure) {
        return `[DOC] ${trimText(c.title, MAX_TITLE_LEN)}\n${trimText(c.content, 2500)}`;
      }

      const title = trimText(c.title, MAX_TITLE_LEN);
      const lines: string[] = [`[SVC] ${title}`];

      if (c.price) pushUniq(lines, `price: $${normPrice(c.price)}`);
      if (c.discountPrice) pushUniq(lines, `discount: $${normPrice(c.discountPrice)}`);

      if (c.duration) {
        const sessionPart = c.duration.replace(/\s*分鐘$/, 'm').replace(/\s+/g, '');
        pushUniq(lines, `duration: ${trimText(sessionPart, 40)}`);
      }

      const effectDur = extractKbEffectDurationLine(c);
      let benefits = firstClause(c.effect ?? c.content.split('\n')[0], 160);
      const effSig = normalizeMaintenanceSig(benefits);
      const durSig = normalizeMaintenanceSig(effectDur);
      if (
        benefits &&
        effectDur &&
        effSig &&
        durSig &&
        effSig === durSig &&
        !benefits.includes('\n')
      ) {
        benefits = '';
      }
      if (benefits) pushUniq(lines, `effect: ${benefits}`);
      if (effectDur) pushUniq(lines, `effect_duration: ${effectDur}`);

      if (c.suitable) {
        const suitablePart = firstClause(c.suitable, 140);
        if (suitablePart) pushUniq(lines, `suitable_for: ${suitablePart}`);
      }
      if (c.unsuitable) {
        const notPart = firstClause(c.unsuitable, 140);
        if (notPart) pushUniq(lines, `not_suitable: ${notPart}`);
      }
      if (!c.suitable && !c.unsuitable) {
        const defSuit = firstClause(options.defaultSuitableFor, 140);
        if (defSuit) pushUniq(lines, `suitable_for: ${defSuit}`);
      }

      const cautionPart = firstClause(c.precaution ?? options.defaultCaution, 120);
      if (cautionPart) pushUniq(lines, `caution: ${cautionPart}`);

      if (c.faqItems?.length) {
        for (const fq of formatFaqCompact(c.faqItems, effectDur)) {
          pushUniq(lines, fq);
        }
      }

      if (isLikelyPackageDoc(c)) {
        const inc = extractPackageIncludeBlock(c.content);
        if (inc) {
          pushUniq(lines, 'includes:');
          for (const row of compactIncludeBlock(inc)) {
            pushUniq(lines, row);
          }
        }
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

export function resolveKbDefaults(businessType: string): {
  defaultSuitableFor: string;
  defaultCaution: string;
} {
  const t = businessType.toLowerCase();
  if (t.includes('clinic') || t.includes('medical') || t.includes('dental')) {
    return { defaultSuitableFor: 'General patients', defaultCaution: 'Follow doctor instructions' };
  }
  if (t.includes('gym') || t.includes('fitness') || t.includes('yoga')) {
    return {
      defaultSuitableFor: 'General fitness customers',
      defaultCaution: 'Consult trainer if you have injuries',
    };
  }
  if (t.includes('restaurant') || t.includes('dining') || t.includes('cafe')) {
    return { defaultSuitableFor: 'All diners', defaultCaution: 'Inform staff of any allergies' };
  }
  return {
    defaultSuitableFor: 'General customers',
    defaultCaution: 'Follow professional aftercare guidance',
  };
}

function formatDraftState(draft: BookingDraft): string {
  const fields: [string, string | null | undefined][] = [];
  if (draft.bookingId) fields.push(['預約 ID (bookingId)', draft.bookingId]);
  if (draft.mode && draft.mode !== 'new') {
    fields.push([
      '流程',
      draft.mode === 'modify' ? '改期' : draft.mode === 'cancel' ? '取消' : String(draft.mode),
    ]);
  }
  fields.push(
    ['服務', draft.serviceDisplayName ?? draft.serviceName],
    ['日期', draft.date],
    ['時間', draft.time],
    ['客戶姓名', draft.customerName],
    ['電話', draft.phone],
  );

  const filled = fields.filter(([, v]) => v);
  const missing = fields.filter(([, v]) => !v);

  if (filled.length === 0) return 'No booking info collected yet.';

  const lines = ['Current booking draft:'];
  for (const [label, val] of filled) lines.push(`  ✓ ${label}: ${val}`);
  for (const [label] of missing) lines.push(`  ✗ ${label}: (not yet collected)`);
  return lines.join('\n');
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const tp = ctx.tenantProfile;
  const businessName = tp?.businessName ?? 'Business';
  const businessType = tp?.businessType ?? 'business';
  const kbDefaults = resolveKbDefaults(businessType);
  const kb = formatKnowledgeChunks(ctx.knowledgeChunks, kbDefaults);
  const draft = formatDraftState(ctx.currentDraft);

  let bookingsSection = '';
  const phoneForListing =
    (ctx.bookingLookupPhone && String(ctx.bookingLookupPhone).trim()) ||
    (ctx.currentDraft?.phone && String(ctx.currentDraft.phone).trim()) ||
    '';

  if (ctx.bookingLookupEmpty && ctx.bookingLookupPhone) {
    bookingsSection = `\n\n## 客戶現有預約\n查無即將預約（電話：${ctx.bookingLookupPhone}）。請確認電話號碼是否正確。`;
  } else if (ctx.existingBookings && ctx.existingBookings.length > 0) {
    const lines = ctx.existingBookings.map((b, i) => {
      const d = new Date(b.startTime);
      const dateStr = formatDateHKYmd(d);
      const timeStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Hong_Kong',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
      const name = b.customerName?.trim() ? b.customerName.trim() : '（未填姓名）';
      return `${i + 1}. [ID: ${b.id}] ${b.serviceName}，${dateStr} ${timeStr}，${name}`;
    });
    const phoneLine = phoneForListing || '（見草稿或對話）';
    bookingsSection = `\n\n## 客戶現有預約\n以下是電話 ${phoneLine} 的即將預約：\n${lines.join('\n')}`;
  }
  const draftName = ctx.currentDraft?.customerName;
  const greeting = draftName
    ? `The customer's name for this booking is ${draftName}. Use it naturally when appropriate.`
    : ctx.contactName
      ? `Contact name on file: ${ctx.contactName} (may be from a previous booking — confirm with the customer if starting a new booking).`
      : '';
  const today = getHKTToday();
  const todayStr = formatDateHKYmd(today);
  const wd = getHKTJsWeekday(today);
  const wdEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd];

  const personaExtras = [
    tp?.assistantRole ? `- Style: ${tp.assistantRole}` : '',
    tp?.language ? `- Language: ${tp.language}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `You are a WhatsApp CS/sales assistant for ${businessName} (${businessType}).
Default language: Cantonese / Traditional Chinese; mirror the user's language naturally (mixed zh/en is fine).
Today: ${todayStr} (${wdEn})${greeting ? `\n${greeting}` : ''}

## Booking State
${draft}${bookingsSection}

## Knowledge Base
${kb}

## Grounding
- Use only the Knowledge Base and booking context above for business facts. If missing, say 我暫時未有相關資料，請聯絡我們了解更多 — do not invent services, prices, durations, effects, policies, or bookings.
- When KB or booking context clearly points to a service, align to that KB service title; do not invent services.
- duration = single-session treatment time. effect_duration / faq.duration = how long results may last. Never swap them.
- For packages, list the included items before quoting the package price.

## Booking Flow
- Required fields: service, date, time, customerName, phone (plus bookingId for modify / cancel).
- Ask at most one missing booking field per turn, unless the user already gave several at once.
- When all required fields are present, CONFIRM_BOOKING with a summary instead of asking for the same details again.
- After a CONFIRM summary:
  - user affirms → SUBMIT_BOOKING (new) / MODIFY_BOOKING / CANCEL_BOOKING (match current mode)
  - user rejects or corrects → COLLECT_BOOKING, update the affected field(s); do not repeat the full summary
- For modify / cancel, use the 客戶現有預約 list above when present; do not invent bookings; confirm the intended changes with the customer before MODIFY_BOOKING or CANCEL_BOOKING.

## Date / Time
- Use Today (${todayStr}) as the reference date; resolve 聽日 / 星期X / 下星期X / literals to YYYY-MM-DD on the Hong Kong calendar.
- If the user message contains a [系統日期解析] hint, follow it exactly.
- X號 = date (YYYY-MM-DD); X點 = time (HH:mm). Never swap them (e.g. 9號11點 → date = the 9th, time = 11:00).

## Output
Return one JSON object only, no markdown fences. Keep reply concise and natural.
{"reply":"…","intent":"GREETING|FAQ|BOOKING_REQUEST|BOOKING_CHANGE|BOOKING_CANCEL|PRICE_INQUIRY|PRODUCT_INQUIRY|AVAILABILITY_CHECK|CONTACT_INFO|OTHER","action":"REPLY|COLLECT_BOOKING|CONFIRM_BOOKING|SUBMIT_BOOKING|MODIFY_BOOKING|CANCEL_BOOKING|HANDOFF","newSlots":{"bookingId":"…","serviceName":"…","serviceDisplayName":"…","date":"YYYY-MM-DD","time":"HH:mm","customerName":"…","phone":"…"}}
newSlots: only fields learned or corrected this turn (omit fields already ✓ in Booking State).${personaExtras ? `\n\n${personaExtras}` : ''}`;
}

export function buildMessages(
  ctx: PromptContext,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  messages.push({ role: 'system', content: buildSystemPrompt(ctx) });

  for (const msg of ctx.conversationHistory) {
    const role = msg.role === 'customer' ? 'user' : 'assistant';
    let content = msg.content;
    if (role === 'assistant' && content.trimStart().startsWith('{')) {
      try {
        const parsed = JSON.parse(content);
        content = parsed.reply ?? parsed.replyText ?? content;
      } catch {
        // not valid JSON, use as-is
      }
    }
    messages.push({ role, content });
  }

  messages.push({ role: 'user', content: ctx.currentMessage });

  return messages;
}