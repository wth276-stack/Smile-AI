// packages/ai-engine/debug-full.js
const OpenAI = require('openai').default;

const SYSTEM = `You are a WhatsApp sales assistant for a beauty/wellness salon.
Reply in the customer's language — default to Cantonese/Traditional Chinese.
今日日期：2026-03-31（星期二）

今日 = 3月31日（星期二）
聽日 = 4月1日（星期三）
星期四 = 4月2日
星期五 = 4月3日
星期六 = 4月4日
星期日 = 4月5日
星期一 = 4月6日
星期二 = 4月7日
下星期三 = 4月8日

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

## Actions
Choose ONE action per reply:
- REPLY — general reply, answering questions, greeting, chitchat
- COLLECT_BOOKING — you are asking for or acknowledging a booking detail (service/date/time/name/phone)
- CONFIRM_BOOKING — all slots are filled, you are asking the customer to confirm the booking
- SUBMIT_BOOKING — the customer confirmed, you are finalizing the booking
- HANDOFF — the situation needs a human agent (complaint, complex request, explicit ask)

## Output Format
Respond with a single JSON object. Do NOT wrap in markdown code fences. Be concise — your entire response should be under 250 tokens.
{
  "reply": "Your reply to the customer in their language (1-3 sentences, natural WhatsApp style)",
  "intent": "GREETING | FAQ | BOOKING_REQUEST | BOOKING_CHANGE | BOOKING_CANCEL | PRICE_INQUIRY | PRODUCT_INQUIRY | AVAILABILITY_CHECK | CONTACT_INFO | OTHER",
  "action": "REPLY | COLLECT_BOOKING | CONFIRM_BOOKING | SUBMIT_BOOKING | HANDOFF",
  "newSlots": {
    "serviceName": "internal service code (only if newly identified this turn)",
    "serviceDisplayName": "display name (only if newly identified this turn)",
    "date": "YYYY-MM-DD (only if newly collected this turn)",
    "time": "HH:mm (only if newly collected this turn)",
    "customerName": "name (only if newly collected this turn)",
    "phone": "phone number (only if newly collected this turn)"
  }
}

Rules for newSlots:
- "New" means the info is NOT yet shown in the Booking State above
- If the Booking State shows a field as missing, and you know the answer from conversation context, you MUST include it in newSlots
- If the Booking State already shows a field as filled, do NOT include it again

## Knowledge Base
【HIFU 拉提緊緻】
HIFU 超聲波拉提療程，針對面部輪廓提升
價錢: HKD 1200
功效: 提拉緊緻
時長: 60分鐘

---

【補濕亮肌 Facial】
深層清潔補濕 facial，適合乾性肌膚，包括潔面、去角質、補濕面膜
價錢: HKD 480
功效: 深層補濕、亮白
時長: 75分鐘

---

【肩頸按摩】
專業肩頸推拿按摩，紓緩都市人肩頸疲勞
價錢: HKD 380
功效: 紓緩肩頸痛
時長: 45分鐘

## Booking State
No booking info collected yet.`;

const messages = [
  { role: 'system', content: SYSTEM },
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: '你好！有什麼我可以幫你嘅？😊' },
  { role: 'user', content: '想預facial' },
];

async function main() {
  const c = new OpenAI({ timeout: 60000, maxRetries: 0 });
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  console.log('Model:', model);
  console.log('System prompt length:', SYSTEM.length, 'chars');
  console.log('Total messages:', messages.length);
  console.log('');

  // Test A: Full prompt, JSON mode
  console.log('--- Test A: Full prompt + JSON mode ---');
  let start = Date.now();
  try {
    const r = await c.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: 2048,
      temperature: 0.3,
    });
    console.log('OK', Date.now() - start + 'ms');
    console.log('Content:', r.choices[0]?.message?.content);
    console.log('Finish:', r.choices[0]?.finish_reason);
    console.log('Usage:', JSON.stringify(r.usage));
  } catch (e) {
    console.error('FAIL', Date.now() - start + 'ms', e.constructor.name, e.message);
  }

  console.log('');

  // Test B: Full prompt, NO JSON mode
  console.log('--- Test B: Full prompt + NO JSON mode ---');
  start = Date.now();
  try {
    const r = await c.chat.completions.create({
      model,
      messages,
      max_tokens: 2048,
      temperature: 0.3,
    });
    console.log('OK', Date.now() - start + 'ms');
    console.log('Content:', r.choices[0]?.message?.content?.slice(0, 300));
    console.log('Finish:', r.choices[0]?.finish_reason);
  } catch (e) {
    console.error('FAIL', Date.now() - start + 'ms', e.constructor.name, e.message);
  }
}

main().catch(console.error);