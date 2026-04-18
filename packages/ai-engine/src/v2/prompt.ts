import type { PromptContext, BookingDraft, KnowledgeChunk } from './types';
import { formatDateHKYmd, getHKTToday } from './date-utils';

const FAQ_MAX_ITEMS = 8;
const FAQ_ANSWER_MAX = 400;
const PACKAGE_BLOCK_MAX = 1200;

function trimText(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Verbatim FAQ — old 2×20char truncation dropped facts (e.g. 12–18 個月). */
function formatFaqBlock(items: Array<{ question: string; answer: string }>): string {
  return items
    .slice(0, FAQ_MAX_ITEMS)
    .map((f, i) => {
      const q = f.question.replace(/^Q[：:\s]*/i, '').trim();
      const a = f.answer.replace(/^A[：:\s]*/i, '').trim();
      return `Q${i + 1}: ${trimText(q, 200)}\nA${i + 1}: ${trimText(a, FAQ_ANSWER_MAX)}`;
    })
    .join('\n');
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
  if (m1) return trimText(m1[0].trim(), PACKAGE_BLOCK_MAX);
  const m2 = content.match(
    /包含：\s*\n([\s\S]*?)(?=\n\n適合人群|\n\n注意：|\n\n有效期：|\n\n常見問題|$)/,
  );
  if (m2) return trimText(`包含：\n${m2[1].trim()}`, PACKAGE_BLOCK_MAX);
  return '';
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

  return chunks
    .map((c) => {
      if (c.title === '營業時間') {
        return `【${c.title}】\n${c.content}`;
      }

      const hasStructure =
        c.price || c.duration || c.effect || c.suitable || c.faqItems?.length;
      if (!hasStructure) {
        return `## ${c.title}\n${c.content}`;
      }

      const pricePart = c.price ? `$${String(c.price).replace(/^HK\$?/i, '').trim()}` : '$-';
      const discountPart = c.discountPrice
        ? ` → $${String(c.discountPrice).replace(/^HK\$?/i, '').trim()}`
        : '';
      const sessionPart = c.duration ? c.duration.replace(/\s*分鐘$/, ' mins') : '-';
      const suitablePart = firstClause(
        c.suitable ?? c.unsuitable ?? options.defaultSuitableFor,
        28,
      );
      const cautionPart = firstClause(c.precaution ?? options.defaultCaution, 28);
      const benefits = firstClause(c.effect ?? c.content.split('\n')[0], 80);

      const effectDur = extractKbEffectDurationLine(c);
      const faqBlock = c.faqItems?.length
        ? formatFaqBlock(c.faqItems)
        : 'N/A';

      const lines: string[] = [
        `## ${trimText(c.title, 24)}`,
        `Price: ${pricePart}${discountPart} | Session length (單次療程時間): ${sessionPart}`,
        ...(effectDur ? [`KB effect duration (功效/FAQ，唔係療程時長): ${effectDur}`] : []),
        `Benefits (excerpt): ${benefits}`,
        `Suitable for: ${suitablePart}`,
        `Caution: ${cautionPart}`,
        `FAQ (verbatim — use for 維持幾耐/價錢/副作用等):\n${faqBlock}`,
      ];

      if (isLikelyPackageDoc(c)) {
        const inc = extractPackageIncludeBlock(c.content);
        if (inc) {
          lines.push(`Package includes (原文 — 問「包含咩」必列此段):\n${inc}`);
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
  const now = getHKTToday();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];

  const personaExtras = [
    tp?.assistantRole ? `- Style: ${tp.assistantRole}` : '',
    tp?.language ? `- Language: ${tp.language}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `You are a WhatsApp sales assistant for ${businessName} (${businessType}).
Default language: Cantonese/Traditional Chinese. 今日日期：${todayStr}（星期${dayOfWeek}）${greeting ? `\n${greeting}` : ''}

## Booking State
${draft}${bookingsSection}

## Knowledge Base
${kb}
知識庫規則：回答服務/價格/FAQ 必須以上述知識庫為唯一依據。若無相關內容，答「我暫時未有相關資料，請聯絡我們了解更多。」嚴禁自行捏造。
服務配對：客人提及服務名（含錯字/簡稱），配對知識庫最近嘅服務。80%+ 確信就直接用，唔好列晒所有服務。
精準事實（禁止用一般醫美常識覆蓋 KB）：「療程時長／Session length」= 單次療程所需時間；「效果維持幾耐／維持幾耐」= 必須用 FAQ 或「KB effect duration」行嘅月數（如 12–18 個月），唔好同療程時長混淆。
套餐問題：問「包含咩／有咩內容／包咩」→ 必須先列出「Package includes」段嘅項目，再補價錢；唔好只答價錢。

## Date/Time Parsing
用上面日曆參考表嚟對應「聽日/星期X/下星期X」→ 實際 YYYY-MM-DD，唔好自己推算。
"X號"=日期(YYYY-MM-DD) "X點"=時間(HH:mm)。兩者獨立，絕對唔可以對調。
例：9號11點 → date:04-09, time:11:00 ✓（唔係 date:04-11, time:09:00）
日期+時間同時出現→同時放入 newSlots。

## Actions
- REPLY — 一般回覆/FAQ/問候
- COLLECT_BOOKING — 收集或確認預約資料（service/date/time/name/phone）
- CONFIRM_BOOKING — 5 格全齊，出 summary 問客人確認
- SUBMIT_BOOKING — 客人確認新預約→你 finalize（唯一會真正建立預約嘅 action）
- MODIFY_BOOKING — 客人確認改期（必須有 bookingId）
- CANCEL_BOOKING — 客人確認取消（必須有 bookingId）
- HANDOFF — 需要真人介入

### Confirmation Rules
1. 唔好用確認語句（確認嗎？OK嗎？）直到 5 格全 ✓。
2. 你出咗 CONFIRM summary 後，客人回 好/OK/確認 → action 必須係 SUBMIT_BOOKING（唔係 REPLY）。
3. 改期/取消 flow：客人確認修改 → action 必須係 MODIFY_BOOKING 或 CANCEL_BOOKING（唔係 SUBMIT_BOOKING）。
4. 客人拒絕確認（唔啱/想改/wrong）→ action=COLLECT_BOOKING，問邊個欄位要改，唔好重複成份 summary。

## Booking Flow
- 自然對話收集，每次問一個欄位；客人一次畀多個就照收
- 改期/取消：需要電話 lookup；多個預約就列出問邊個
- 改期確認前必先 confirm change details

## Output
Single JSON, no code fences, <250 tokens.
{"reply":"…","intent":"GREETING|FAQ|BOOKING_REQUEST|BOOKING_CHANGE|BOOKING_CANCEL|PRICE_INQUIRY|PRODUCT_INQUIRY|AVAILABILITY_CHECK|CONTACT_INFO|OTHER","action":"REPLY|COLLECT_BOOKING|CONFIRM_BOOKING|SUBMIT_BOOKING|MODIFY_BOOKING|CANCEL_BOOKING|HANDOFF","newSlots":{"bookingId":"…","serviceName":"…","serviceDisplayName":"…","date":"YYYY-MM-DD","time":"HH:mm","customerName":"…","phone":"…"}}
newSlots 規則：只放本輪**新**收集到嘅欄位（Booking State 已 ✓ 嘅唔好重複）。✗ 但你知道嘅就必須填。

Voice: friendly, professional, concise; 1-2 emoji max.${personaExtras ? ` ${personaExtras}` : ''}`;
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