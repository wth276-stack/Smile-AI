import OpenAI, { APIConnectionError, APIConnectionTimeoutError } from 'openai';
import type {
  AiEngineInput,
  AiEngineResult,
  AiAction,
  AiIntent,
  LLMOutput,
  BookingDraft,
  PromptContext,
  TenantProfile,
} from './types';
import { buildMessages } from './prompt';
import { validateOutput } from './validator';

const FALLBACK_REPLY = '抱歉，系統暫時遇到問題，請稍後再試 🙏';

const MAX_HISTORY = 10;
const API_TIMEOUT_MS = 60_000;

const EMPTY_DRAFT: BookingDraft = {
  serviceName: null,
  serviceDisplayName: null,
  date: null,
  time: null,
  customerName: null,
  phone: null,
};

function buildCalendarRef(today?: Date): string {
  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const d = today ?? new Date();

  function addDays(base: Date, n: number): Date {
    const r = new Date(base);
    r.setDate(base.getDate() + n);
    return r;
  }
  function fmt(date: Date): string {
    return `${date.getMonth() + 1}月${date.getDate()}日（星期${dayLabels[date.getDay()]}）`;
  }
  function fmtShort(date: Date): string {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  const lines: string[] = [];
  lines.push(`今日 = ${fmt(d)}`);
  lines.push(`聽日 = ${fmt(addDays(d, 1))}`);

  const seen = new Set<number>();
  for (let i = 2; i <= 9; i++) {
    const target = addDays(d, i);
    const dow = target.getDay();
    if (seen.has(dow)) continue;
    seen.add(dow);
    const prefix = i <= 7 ? '星期' : '下星期';
    lines.push(`${prefix}${dayLabels[dow]} = ${fmtShort(target)}`);
  }

  return lines.join('\n');
}

function mapActionToLegacy(action: string): AiAction {
  switch (action) {
    case 'COLLECT_BOOKING':
      return 'ASK_INFO';
    case 'CONFIRM_BOOKING':
      return 'REQUEST_BOOKING';
    case 'SUBMIT_BOOKING':
      return 'REQUEST_BOOKING';
    case 'MODIFY_BOOKING':
      return 'MODIFY_BOOKING';
    case 'CANCEL_BOOKING':
      return 'CANCEL_BOOKING';
    case 'HANDOFF':
      return 'REPLY_ONLY';
    case 'REPLY':
      return 'REPLY_ONLY';
    default:
      return 'REPLY_ONLY';
  }
}

function buildExtractedFields(slots: Partial<BookingDraft>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(slots)) {
    if (v != null) fields[k] = v;
  }
  return fields;
}

/* ── Bug 1 fix：從 raw JSON 提取 reply 文字 ── */
function extractReplyFromAssistantContent(content: string): string {
  if (!content.startsWith('{')) return content;
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed.reply === 'string' && parsed.reply.length > 0) {
      return parsed.reply;
    }
    if (typeof parsed.replyText === 'string' && parsed.replyText.length > 0) {
      return parsed.replyText;
    }
  } catch {
    // 唔係 JSON，直接用原文
  }
  return content;
}
function ensureAssistantJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    try {
      JSON.parse(trimmed);
      return trimmed; // 已經係 valid JSON
    } catch { /* 唔係 JSON，繼續包裝 */ }
  }
  // 純文字 → 包成 JSON 格式，等 model 保持 JSON 輸出
  return JSON.stringify({ reply: content, intent: 'REPLY', action: 'REPLY' });
}
function readSettingString(
  settings: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = settings[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function tenantProfileFromSettings(settings: Record<string, unknown>): TenantProfile {
  return {
    businessName: readSettingString(settings, 'businessName', 'business_name'),
    businessType: readSettingString(settings, 'businessType', 'business_type'),
    assistantRole: readSettingString(
      settings,
      'assistantRole',
      'assistant_role',
      'assistantPersona',
      'assistant_persona',
    ),
    language: readSettingString(settings, 'language', 'locale'),
  };
}

function buildPromptContext(input: AiEngineInput): PromptContext {
  const allHistory: PromptContext['conversationHistory'] = input.messages.map((m) => {
    const raw = m as unknown as Record<string, unknown>;
    const isUser = raw.sender === 'CUSTOMER' || raw.role === 'user';

    /* Bug 1 fix：assistant message 只送 reply 文字，唔送成嚿 JSON */
    const content = isUser ? m.content : ensureAssistantJson(m.content);

    return {
      role: isUser ? ('customer' as const) : ('assistant' as const),
      content,
    };
  });

  const trimmed = allHistory.length > MAX_HISTORY
    ? allHistory.slice(-MAX_HISTORY)
    : allHistory;

  return {
    tenantProfile: tenantProfileFromSettings(input.tenant.settings ?? {}),
    knowledgeChunks: input.knowledge,
    conversationHistory: trimmed,
    currentMessage: input.currentMessage,
    currentDraft: input.bookingDraft ?? { ...EMPTY_DRAFT },
    contactName: input.contact.name ?? null,
    tenantSettings: input.tenant.settings ?? {},
    existingBookings: input.existingBookings,
  };
}

function buildFallbackResult(durationMs: number): AiEngineResult {
  return {
    replyText: FALLBACK_REPLY,
    signals: {
      intents: ['OTHER'],
      extractedFields: {},
      action: 'REPLY_ONLY',
    },
    sideEffects: [],
    shouldHandoff: false,
    analytics: { model: 'unknown', inputTokens: 0, outputTokens: 0, durationMs },
  };
}

/* ── Bug 2 fix：如果 LLM 冇填 serviceName 但 reply 提到已知服務，自動補上 ── */
function inferMissingService(
  newSlots: Partial<BookingDraft>,
  mergedDraft: BookingDraft,
  replyText: string,
  knowledge: unknown[],
): Partial<BookingDraft> {
  if (mergedDraft.serviceName || newSlots.serviceName) return newSlots;

  const servicePatterns: { name: string; display: string }[] = [];
  for (const chunk of knowledge) {
    const text = typeof chunk === 'string' ? chunk : JSON.stringify(chunk);
    const match = text.match(/【(.+?)】/);
    if (match) {
      servicePatterns.push({ name: match[1], display: match[1] });
    }
  }

  for (const svc of servicePatterns) {
    if (replyText.includes(svc.display)) {
      console.log(`[v2/engine] Auto-inferred missing serviceName: ${svc.name}`);
      return {
        ...newSlots,
        serviceName: svc.name,
        serviceDisplayName: svc.display,
      };
    }
  }

  return newSlots;
}

/* ── 從截斷嘅 JSON 用 regex 提取資料 ── */
function extractFromTruncatedJson(raw: string): LLMOutput | null {
  const replyMatch = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!replyMatch) return null;

  const extractedReply = replyMatch[1]
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');

  const intentMatch = raw.match(/"intent"\s*:\s*"([^"]+)"/);
  const actionMatch = raw.match(/"action"\s*:\s*"([^"]+)"/);

  // 嘗試提取 newSlots
  const slots: Partial<BookingDraft> = {};
  const serviceNameMatch = raw.match(/"serviceName"\s*:\s*"([^"]+)"/);
  const serviceDisplayMatch = raw.match(/"serviceDisplayName"\s*:\s*"([^"]+)"/);
  const dateMatch = raw.match(/"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
  const timeMatch = raw.match(/"time"\s*:\s*"(\d{2}:\d{2})"/);
  const nameMatch = raw.match(/"customerName"\s*:\s*"([^"]+)"/);
  const phoneMatch = raw.match(/"phone"\s*:\s*"([^"]+)"/);

  if (serviceNameMatch) slots.serviceName = serviceNameMatch[1];
  if (serviceDisplayMatch) slots.serviceDisplayName = serviceDisplayMatch[1];
  if (dateMatch) slots.date = dateMatch[1];
  if (timeMatch) slots.time = timeMatch[1];
  if (nameMatch) slots.customerName = nameMatch[1];
  if (phoneMatch) slots.phone = phoneMatch[1];

  console.log('[v2/engine] Regex extracted reply:', extractedReply);
  console.log('[v2/engine] Regex extracted slots:', JSON.stringify(slots));

  return {
    thinking: '',
    reply: extractedReply,
    intent: (intentMatch?.[1] ?? 'OTHER') as AiIntent,
    action: (actionMatch?.[1] ?? 'REPLY') as AiAction,
    newSlots: slots,
  };
}

export function resolveRelativeDates(text: string, today?: Date): string | null {
  const d = today ?? new Date();
  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const dow = d.getDay();

  function addDays(base: Date, n: number): Date {
    const r = new Date(base);
    r.setDate(base.getDate() + n);
    return r;
  }
  function fmtResult(label: string, target: Date): string {
    const iso = target.toISOString().split('T')[0];
    return `${label} = ${iso}（星期${dayLabels[target.getDay()]}）`;
  }

  const dayCharToNum: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0,
  };

  const results: string[] = [];

  if (/今日|今天/.test(text)) {
    results.push(fmtResult('今日', d));
  }
  if (/聽日|明天|明日/.test(text)) {
    results.push(fmtResult('聽日', addDays(d, 1)));
  }
  if (/後日|後天/.test(text)) {
    results.push(fmtResult('後日', addDays(d, 2)));
  }

  const nextWeekRe = /(?:下(?:個)?(?:星期|週|禮拜))([一二三四五六日天])/g;
  let m: RegExpExecArray | null;
  while ((m = nextWeekRe.exec(text)) !== null) {
    const targetDay = dayCharToNum[m[1]];
    if (targetDay === undefined) continue;
    const daysUntilNextMon = ((1 - dow + 7) % 7) || 7;
    const nextMon = addDays(d, daysUntilNextMon);
    const offset = ((targetDay - 1 + 7) % 7);
    const target = addDays(nextMon, offset);
    results.push(fmtResult(m[0], target));
  }

  const thisWeekRe = /(?:呢個|今個|這個|這)(?:星期|週|禮拜)([一二三四五六日天])/g;
  while ((m = thisWeekRe.exec(text)) !== null) {
    const targetDay = dayCharToNum[m[1]];
    if (targetDay === undefined) continue;
    const diff = ((targetDay - dow + 7) % 7);
    const target = addDays(d, diff || 7);
    results.push(fmtResult(m[0], target));
  }

  const bareWeekRe = /(?<!下個?|呢個|今個|這個|這)星期([一二三四五六日天])/g;
  while ((m = bareWeekRe.exec(text)) !== null) {
    const fullPrefix = text.slice(Math.max(0, m.index - 3), m.index);
    if (/下|呢|今|這/.test(fullPrefix)) continue;
    const targetDay = dayCharToNum[m[1]];
    if (targetDay === undefined) continue;
    let diff = ((targetDay - dow + 7) % 7);
    if (diff === 0) diff = 7;
    const target = addDays(d, diff);
    results.push(fmtResult(m[0], target));
  }

  const todayMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNumRe = /(\d{1,2})[號号日]/g;
  while ((m = dayNumRe.exec(text)) !== null) {
    const dayNum = parseInt(m[1], 10);
    if (dayNum < 1 || dayNum > 31) continue;
    let target = new Date(d.getFullYear(), d.getMonth(), dayNum);
    if (target.getDate() !== dayNum) continue;
    if (target < todayMidnight) {
      target = new Date(d.getFullYear(), d.getMonth() + 1, dayNum);
      if (target.getDate() !== dayNum) continue;
    }
    results.push(fmtResult(`${dayNum}號`, target));
  }

  if (results.length === 0) return null;
  return results.join('\n');
}

export async function runAiEngineV2(input: AiEngineInput): Promise<AiEngineResult> {
  const start = Date.now();

  try {
    const ctx = buildPromptContext(input);
    const messages = buildMessages(ctx);
    for (const msg of messages) {
  if (msg.role === 'assistant' && typeof msg.content === 'string') {
    const trimmed = (msg.content as string).trim();
    if (!trimmed.startsWith('{')) {
      msg.content = JSON.stringify({ reply: trimmed, intent: 'REPLY', action: 'REPLY' });
    }
  }
}
    // 注入日曆參考到 system prompt
    if (messages.length > 0 && messages[0].role === 'system') {
      const content = messages[0].content as string;
      const calendar = buildCalendarRef();
      const dateLineRegex = /(今日日期：[^\n]+\n)/;
      if (dateLineRegex.test(content)) {
        messages[0].content = content.replace(dateLineRegex, `$1\n${calendar}\n`);
      } else {
        messages[0].content = calendar + '\n\n' + content;
      }
    }

    const resolvedDates = resolveRelativeDates(input.currentMessage);
    if (resolvedDates) {
      const dateHint = `\n\n[系統日期解析] 以下日期已由系統準確計算，你必須直接使用，不要自行推算：\n${resolvedDates}`;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          messages[i].content += dateHint;
          break;
        }
      }
      console.log('[v2/engine] Injected date hint into user message:', resolvedDates);
    }

    console.log(`[v2/engine] Sending ${messages.length} messages to OpenAI (trimmed to last ${MAX_HISTORY})`);
    console.log('[v2/engine] Messages payload:', JSON.stringify(messages, null, 2));

    const client = new OpenAI({ timeout: API_TIMEOUT_MS, maxRetries: 0 });
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const MAX_RETRIES = 1;
    let response: OpenAI.Chat.Completions.ChatCompletion | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[v2/engine] OpenAI request attempt ${attempt + 1} with timeout ${API_TIMEOUT_MS / 1000}s`);
        response = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
        });
        break;
      } catch (err) {
        const isRetryable =
          err instanceof APIConnectionTimeoutError ||
          err instanceof APIConnectionError;
        if (!isRetryable || attempt === MAX_RETRIES) throw err;
        const delay = 1000 * Math.pow(2, attempt);
        console.log('[v2/engine] Retry attempt', attempt + 1, 'after error:', (err as Error).message, `(waiting ${delay}ms)`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (!response) throw new Error('No response from OpenAI after retries');

    const finishReason = response.choices[0]?.finish_reason;
    const content = response.choices[0]?.message?.content;

    console.log('[v2/engine] Finish reason:', finishReason);
    console.log('[v2/engine] Content type:', typeof content);
    console.log('[v2/engine] Content length:', content?.length);
    console.log('[v2/engine] Content preview:', typeof content === 'string' ? content.substring(0, 500) : String(content));
    console.log('[v2/engine] Usage:', JSON.stringify(response.usage));

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      console.error('[v2/engine] Empty or invalid response from OpenAI. Type:', typeof content, 'Value:', JSON.stringify(content));
      return buildFallbackResult(Date.now() - start);
    }

    const rawText = content.trim();
    console.log('[v2/engine] Raw LLM response:', rawText);

    let parsed: LLMOutput;
    try {
      let jsonStr = rawText;
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }
      parsed = JSON.parse(jsonStr) as LLMOutput;
    } catch {
      console.warn('[v2/engine] JSON parse failed. Finish reason:', finishReason, 'Attempting regex extraction...');

      const extracted = extractFromTruncatedJson(rawText);
      if (extracted) {
        parsed = extracted;
      } else {
        console.error('[v2/engine] Regex extraction also failed. Raw:', rawText.slice(0, 300));
        return buildFallbackResult(Date.now() - start);
      }
    }

    const raw = parsed as unknown as Record<string, unknown>;
    const normalized = {
      replyText: (raw.replyText ?? raw.reply ?? '') as string,
      intents: Array.isArray(raw.intents)
        ? (raw.intents as string[])
        : raw.intent
          ? [raw.intent as string]
          : [],
      action: (raw.action ?? 'REPLY_ONLY') as string,
      newSlots: (raw.newSlots ?? raw.bookingDraft ?? {}) as Partial<BookingDraft>,
      bookingDraft: (raw.bookingDraft ?? raw.newSlots ?? {}) as Partial<BookingDraft>,
    };

    const validated = validateOutput(normalized, ctx);
    const legacyAction = mapActionToLegacy(validated.action as string);

    if (validated.validationIssues.length > 0) {
      console.warn('[v2/engine] Validation issues:', validated.validationIssues);
    }

    /* Bug 2 fix：自動補漏 serviceName */
    const finalNewSlots = inferMissingService(
      validated.newSlots,
      validated.mergedDraft,
      normalized.replyText,
      input.knowledge,
    );

    /* 如果有補上 service，更新 mergedDraft */
    const finalMergedDraft = { ...validated.mergedDraft };
    if (finalNewSlots.serviceName && !finalMergedDraft.serviceName) {
      finalMergedDraft.serviceName = finalNewSlots.serviceName;
    }
    if (finalNewSlots.serviceDisplayName && !finalMergedDraft.serviceDisplayName) {
      finalMergedDraft.serviceDisplayName = finalNewSlots.serviceDisplayName;
    }

    let finalAction = validated.action as string;
    if (finalAction === 'CONFIRM_BOOKING' || finalAction === 'SUBMIT_BOOKING') {
      const required = ['serviceName', 'date', 'time', 'customerName', 'phone'] as const;
      const missing = required.filter((k) => !finalMergedDraft[k]);
      if (missing.length > 0) {
        console.log('[v2/engine] CONFIRM_BOOKING but missing:', missing);
        finalAction = 'COLLECT_BOOKING';
      }
    }
    // Pass through MODIFY_BOOKING and CANCEL_BOOKING as-is
    if (finalAction === 'MODIFY_BOOKING' || finalAction === 'CANCEL_BOOKING') {
      // These don't need slot validation — bookingId is validated by validator.ts
    }
    const finalLegacyAction = mapActionToLegacy(finalAction);

    const result: AiEngineResult & { _rawLlmJson?: string } = {
      replyText: validated.validatedReply,
      signals: {
        intents: [validated.intent as AiIntent],
        extractedFields: buildExtractedFields(finalNewSlots),
        action: finalLegacyAction,
        bookingDraft: finalMergedDraft,
      },
      sideEffects: [],
      shouldHandoff: finalAction === 'HANDOFF',
      analytics: {
        model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        durationMs: Date.now() - start,
      },
    };
    (result as any)._rawLlmJson = rawText;
    (result as any)._v2Action = finalAction;
    return result;
  } catch (err: any) {
    if (err?.code === 'ETIMEDOUT' || err?.message?.includes('timeout') || err?.type === 'request-timeout') {
      console.error(`[v2/engine] OpenAI API timed out after ${API_TIMEOUT_MS}ms`);
    } else {
      console.error('[v2/engine] Unexpected error:', err);
    }
    return buildFallbackResult(Date.now() - start);
  }
}