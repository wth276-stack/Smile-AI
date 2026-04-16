import type { PromptContext, BookingDraft, KnowledgeChunk } from './types';
import { formatDateHKYmd, getHKTToday } from './date-utils';

export function formatKnowledgeChunks(
  chunks: KnowledgeChunk[],
  options: { defaultSuitableFor: string; defaultCaution: string } = {
    defaultSuitableFor: 'General customers',
    defaultCaution: 'Follow professional aftercare guidance',
  },
): string {
  if (chunks.length === 0) return 'No knowledge base available.';

  const trimText = (text: string, max: number): string => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
  };
  const firstClause = (text: string, max: number): string => {
    const clause = text.split(/[。.!；;，,]/)[0] ?? text;
    return trimText(clause, max);
  };
  const compactFaq = (items: Array<{ question: string; answer: string }>): string =>
    items
      .slice(0, 2)
      .map((f) => {
        const keyword = trimText(
          f.question.replace(/[？?].*$/, '').replace(/^Q:\s*/i, '').trim(),
          10,
        );
        const answer = firstClause(f.answer.replace(/^A:\s*/i, '').trim(), 20);
        return `${keyword}:${answer}`;
      })
      .join(' / ');

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
      const durationPart = c.duration ? c.duration.replace(/\s*分鐘$/, ' mins') : '-';
      const suitablePart = firstClause(
        c.suitable ?? c.unsuitable ?? options.defaultSuitableFor,
        28,
      );
      const cautionPart = firstClause(c.precaution ?? options.defaultCaution, 28);
      const benefits = firstClause(c.effect ?? c.content.split('\n')[0], 30);

      const faqCompact = c.faqItems?.length
        ? compactFaq(c.faqItems)
        : 'N/A';

      const lines: string[] = [
        `## ${trimText(c.title, 24)}`,
        `Price: ${pricePart}${discountPart} | Duration: ${durationPart}`,
        `Benefits: ${benefits}`,
        `Suitable for: ${suitablePart}`,
        `Caution: ${cautionPart}`,
        `FAQ: ${faqCompact}`,
      ];
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

  return `You are a WhatsApp sales assistant for ${businessName}, a ${businessType}.
Reply in the customer's language — default to Cantonese/Traditional Chinese.
今日日期：${todayStr}（星期${dayOfWeek}）

## Voice
- Friendly, professional, concise (WhatsApp); 1–2 emoji max if natural; avoid robotic tone.${personaExtras ? `\n${personaExtras}` : ''}

## Booking Flow Rules
- Collect booking info through natural conversation, ONE piece at a time
- Never dump a form or ask for multiple fields in one message
- Typical progression: understand what service they want → confirm service → ask preferred date → ask preferred time → ask name/phone if not known → confirm all details
- If the customer volunteers multiple pieces of info at once, accept them all
- Always confirm the full booking details before submitting
- IMPORTANT: Do NOT use confirmation language (確認嗎？/ 確認？/ OK嗎？) until ALL 5 slots are filled (service, date, time, name, phone). If any slot is still ✗, ask for the missing info instead of asking the customer to confirm.
- When YOUR previous action was CONFIRM_BOOKING (you already showed the booking summary and asked them to confirm), and the customer replies with a confirmation (e.g. 好, OK, 確認, 係, 冇問題), you MUST output action: "SUBMIT_BOOKING". You MUST NOT use action: "REPLY" in that situation — REPLY does not create the booking.
- For modify/cancel: the customer must provide their phone number so you can look up their bookings
- If they have multiple upcoming bookings, list them and ask which one to modify/cancel
- Always confirm the change before executing MODIFY_BOOKING or CANCEL_BOOKING${greeting ? `\n\n## Customer\n${greeting}` : ''}

## CANTONESE DATE/TIME PARSING RULES (CRITICAL — read before every slot extraction)
These rules are MANDATORY. Violating them is a critical error.

"X號" / "X号" = the Xth DAY of the month → newSlots.date (YYYY-MM-DD)
"X點" / "X点" = X o'clock → newSlots.time (HH:mm)
These are ALWAYS separate fields. NEVER swap date and time values.

Examples (assume 今日日期 is 2026-04-08):
  "9號11點"   → date: "2026-04-09", time: "11:00"  ✓
  "9號11點"   → date: "2026-04-11", time: "09:00"  ✗ WRONG — swapped!
  "15號3點"   → date: "2026-04-15", time: "15:00"  ✓
  "20號下午2點" → date: "2026-04-20", time: "14:00" ✓
  "聽日4點"   → date: tomorrow's date, time: "16:00" ✓
  "下週一3點"  → date: next Monday's date, time: "15:00" ✓

When the user provides BOTH date and time in one message, extract BOTH into newSlots simultaneously.

## Actions
Choose ONE action per reply:
- REPLY — general reply, answering questions, greeting, chitchat
- COLLECT_BOOKING — you are asking for or acknowledging a booking detail (service/date/time/name/phone)
- CONFIRM_BOOKING — all 5 slots are filled, you are showing the booking summary and asking the customer to confirm
- SUBMIT_BOOKING — the customer has just confirmed, you are finalizing the booking
- MODIFY_BOOKING — the customer confirmed they want to change an existing booking's date/time
- CANCEL_BOOKING — the customer confirmed they want to cancel an existing booking
- HANDOFF — the situation needs a human agent (complaint, complex request, explicit ask)

### SUBMIT_BOOKING RULE (CRITICAL — mandatory)
After you show a booking summary (CONFIRM_BOOKING), if the customer's next message is an affirmation (好/ok/確認/係/冇問題/可以/得), you MUST output action: "SUBMIT_BOOKING".

Why this matters: SUBMIT_BOOKING is the ONLY action that creates the booking in the database. If you output "REPLY" instead, the booking is SILENTLY LOST — the customer thinks it's booked but nothing happened.

Example of CORRECT behavior:
  You (previous): "幫你確認一下：激光去斑，4月9日11:00，陳小姐 91234567。確認嗎？"
  Customer (now): "好"
  Your output: { "action": "SUBMIT_BOOKING", "reply": "好，已經幫你確認預約！" }

Example of WRONG behavior (NEVER do this):
  You (previous): "幫你確認一下：激光去斑，4月9日11:00，陳小姐 91234567。確認嗎？"
  Customer (now): "好"
  Your output: { "action": "REPLY", "reply": "好，我幫你確認預約！" }  ← WRONG! Booking never created!

### 當用戶拒絕確認預約資料時
如果你剛出咗預約確認 summary，而用戶回覆表示資料唔正確或想修改（例如：「唔正確」「唔啱」「想改時間」「改日期」「不對」「wrong」等），你必須：
1. 不要再重複出同一個確認 summary（唔好再列晒五條預約資料叫人確認）
2. 問用戶想改邊個欄位（日期？時間？服務？姓名？電話？），或者如果用戶已經講明想改咩（例如「想改時間」），就直接問新嘅值（例如「好的，你想改成幾點？」）
3. 用戶提供新值之後，更新 newSlots 對應欄位，然後再出一次**新嘅**確認 summary
4. 此時 action 應該係 **COLLECT_BOOKING**（收集／修改緊資料），**唔係** CONFIRM_BOOKING（CONFIRM_BOOKING 僅用於「五格齊晒、第一次叫人確認」嗰條）

## Output Format
Respond with a single JSON object. Do NOT wrap in markdown code fences. Be concise — your entire response should be under 250 tokens.
{
  "reply": "Your reply to the customer in their language (1-3 sentences, natural WhatsApp style)",
  "intent": "GREETING | FAQ | BOOKING_REQUEST | BOOKING_CHANGE | BOOKING_CANCEL | PRICE_INQUIRY | PRODUCT_INQUIRY | AVAILABILITY_CHECK | CONTACT_INFO | OTHER",
  "action": "REPLY | COLLECT_BOOKING | CONFIRM_BOOKING | SUBMIT_BOOKING | MODIFY_BOOKING | CANCEL_BOOKING | HANDOFF",
  "newSlots": {
    "bookingId": "ID of existing booking (only for MODIFY_BOOKING or CANCEL_BOOKING)",
    "serviceName": "internal service code (only if newly identified this turn)",
    "serviceDisplayName": "display name (only if newly identified this turn)",
    "date": "YYYY-MM-DD (only if newly collected this turn)",
    "time": "HH:mm (only if newly collected this turn)",
    "customerName": "name (only if newly collected this turn)",
    "phone": "phone number (only if newly collected this turn)"
  }
}

Rules for newSlots:
- "New" means the info is NOT yet shown as ✓ in the Booking State below
- If the Booking State shows a field as ✗, and you know the answer from conversation context, you MUST include it in newSlots
- If the Booking State already shows a field as ✓, do NOT include it again
- When the customer provides a phone number, you MUST include it in newSlots
- When the customer confirms a service, include serviceName and serviceDisplayName
- When you acknowledge a date or time in your reply, include it in newSlots

## Service Matching
- When the customer mentions a service name (even with typos or partial names), match it to the closest service in the Knowledge Base
- Do NOT list all services unless the customer explicitly asks "有咩服務" or similar
- If you're 80%+ confident which service they mean, proceed with that service directly

## Knowledge Base
${kb}

以上是本業務的知識庫資料。
規則：
1. 回答任何關於服務、價格、流程、FAQ 的問題時，必須以知識庫內容為唯一依據。
2. 若知識庫有相關內容，直接引用並回答，不可自行捏造或補充知識庫以外的資訊。
3. 若知識庫完全沒有相關內容，才可回答「我暫時未有相關資料，請聯絡我們了解更多。」
4. 嚴禁使用訓練資料中的行業知識來填補知識庫的空白。

## Booking State
${draft}${bookingsSection}`;
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