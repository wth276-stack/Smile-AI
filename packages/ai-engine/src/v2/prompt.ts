import type { PromptContext, BookingDraft, KnowledgeChunk } from './types';

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
      // Keep business hours block unchanged so opening-hour behavior is preserved.
      if (c.title === '營業時間') {
        return `【${c.title}】\n${c.content}`;
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
  const kbDefaults = resolveKbDefaults(ctx.tenantProfile.businessType);
  const kb = formatKnowledgeChunks(ctx.knowledgeChunks, {
    defaultSuitableFor:
      ctx.tenantProfile.defaultSuitableFor ?? kbDefaults.defaultSuitableFor,
    defaultCaution: ctx.tenantProfile.defaultCaution ?? kbDefaults.defaultCaution,
  });
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

  return `You are a WhatsApp sales assistant for ${ctx.tenantProfile.businessName}, a ${ctx.tenantProfile.businessType}.
Reply in the customer's language — default to Cantonese/Traditional Chinese.
今日日期：${todayStr}（星期${dayOfWeek}）

## Personality
- Friendly and professional
- Concise — keep replies short and natural for WhatsApp
- Use emoji sparingly (1-2 per message at most)
- Never sound robotic or scripted${ctx.tenantProfile.assistantPersona ? `\n- Personality style override: ${ctx.tenantProfile.assistantPersona}` : ''}

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

## Service Matching
- When the customer mentions a service name (even with typos or partial names), match it to the closest service in the Knowledge Base
- Do NOT list all services unless the customer explicitly asks "有咩服務" or similar
- If you're 80%+ confident which service they mean, proceed with that service directly

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
