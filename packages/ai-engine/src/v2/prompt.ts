import type { PromptContext, BookingDraft, KnowledgeChunk } from './types';

export function formatKnowledgeChunks(chunks: KnowledgeChunk[]): string {
  if (chunks.length === 0) return 'No knowledge base available.';

  return chunks
    .map((c) => {
      const lines: string[] = [`【${c.title}】`];
      lines.push(c.content);
      if (c.price) lines.push(`價錢: ${c.price}`);
      if (c.discountPrice) lines.push(`優惠價: ${c.discountPrice}`);
      if (c.effect) lines.push(`功效: ${c.effect}`);
      if (c.duration) lines.push(`時長: ${c.duration}`);
      if (c.suitable) lines.push(`適合: ${c.suitable}`);
      if (c.unsuitable) lines.push(`不適合: ${c.unsuitable}`);
      if (c.precaution) lines.push(`注意事項: ${c.precaution}`);
      if (c.steps?.length) lines.push(`步驟: ${c.steps.join(' → ')}`);
      if (c.faqItems?.length) {
        for (const faq of c.faqItems) {
          lines.push(`Q: ${faq.question}\nA: ${faq.answer}`);
        }
      }
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}

function formatDraftState(draft: BookingDraft): string {
  const fields = [
    ['服務', draft.serviceDisplayName ?? draft.serviceName],
    ['日期', draft.date],
    ['時間', draft.time],
    ['客戶姓名', draft.customerName],
    ['電話', draft.phone],
  ];

  const filled = fields.filter(([, v]) => v);
  const missing = fields.filter(([, v]) => !v);

  if (filled.length === 0) return 'No booking info collected yet.';

  const lines = ['Current booking draft:'];
  for (const [label, val] of filled) lines.push(`  ✓ ${label}: ${val}`);
  for (const [label] of missing) lines.push(`  ✗ ${label}: (not yet collected)`);
  return lines.join('\n');
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const kb = formatKnowledgeChunks(ctx.knowledgeChunks);
  const draft = formatDraftState(ctx.currentDraft);
  const bookingsSection = ctx.existingBookings && ctx.existingBookings.length > 0
    ? `\n\n## Customer's Upcoming Bookings\n${ctx.existingBookings.map((b, i) => {
        const d = new Date(b.startTime);
        const dateStr = d.toISOString().split('T')[0];
        const timeStr = d.toTimeString().slice(0, 5);
        return `${i + 1}. [ID: ${b.id}] ${b.serviceName} — ${dateStr} ${timeStr} (${b.status})`;
      }).join('\n')}`
    : '';
  const greeting = ctx.contactName ? `The customer's name is ${ctx.contactName}. Use it naturally when appropriate.` : '';
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];

  return `You are a WhatsApp sales assistant for a beauty/wellness salon.
Reply in the customer's language — default to Cantonese/Traditional Chinese.
今日日期：${todayStr}（星期${dayOfWeek}）

## Personality
- Friendly and professional
- Concise — keep replies short and natural for WhatsApp
- Use emoji sparingly (1-2 per message at most)
- Never sound robotic or scripted

## Booking Flow Rules
- Collect booking info through natural conversation, ONE piece at a time
- Never dump a form or ask for multiple fields in one message
- Typical progression: understand what service they want → confirm service → ask preferred date → ask preferred time → ask name/phone if not known → confirm all details
- If the customer volunteers multiple pieces of info at once, accept them all
- Always confirm the full booking details before submitting
- For modify/cancel: the customer must provide their phone number so you can look up their bookings
- If they have multiple upcoming bookings, list them and ask which one to modify/cancel
- Always confirm the change before executing MODIFY_BOOKING or CANCEL_BOOKING${greeting ? `\n\n## Customer\n${greeting}` : ''}

## Actions
Choose ONE action per reply:
- REPLY — general reply, answering questions, greeting, chitchat
- COLLECT_BOOKING — you are asking for or acknowledging a booking detail (service/date/time/name/phone)
- CONFIRM_BOOKING — all slots are filled, you are asking the customer to confirm the booking
- SUBMIT_BOOKING — the customer confirmed, you are finalizing the booking
- MODIFY_BOOKING — the customer confirmed they want to change an existing booking's date/time
- CANCEL_BOOKING — the customer confirmed they want to cancel an existing booking
- HANDOFF — the situation needs a human agent (complaint, complex request, explicit ask)

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
- "New" means the info is NOT yet shown as ✓ in the Booking State above
- If the Booking State shows a field as ✗, and you know the answer from conversation context, you MUST include it in newSlots
- If the Booking State already shows a field as ✓, do NOT include it again
- When the customer provides a phone number, you MUST include it in newSlots
- When the customer confirms a service, include serviceName and serviceDisplayName
- When you acknowledge a date or time in your reply, include it in newSlots

## Knowledge Base
${kb}

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
