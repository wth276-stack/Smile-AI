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
  SideEffect,
  SideEffectBookingChanges,
  ServiceEntry,
  AuditPreBoundarySnapshot,
} from './types';
import { buildMessages } from './prompt';
import {
  mergeBookingDraft,
  validateOutput,
  isConfirmationMessage,
  DUPLICATE_AFFIRM_GUARD_ISSUE,
  replyHasConfirmationSummary,
} from './validator';
import { applyConfirmationBoundaryPostProcess } from './confirmation-boundary';
import {
  bookingDraftHasAllRequiredSlots,
  buildBookingDateTime,
  extractSlots,
  getMissingBookingSlots,
} from '../booking-state';
import { buildServiceCatalog, buildServiceTaxonomy, detectServiceSwitch, matchService } from '../service-matcher';
import { buildSlotPolicyFromTenantSettings, validateBookingSlot } from '../booking-slot-availability';

const FALLBACK_REPLY = '抱歉，系統暫時遇到問題，請稍後再試 🙏';

function isV2DebugEnabled(): boolean {
  const v = process.env.AI_ENGINE_V2_DEBUG;
  return v === '1' || v === 'true';
}
function debugLog(...args: unknown[]): void {
  if (isV2DebugEnabled()) {
    console.log(...(args as [unknown, ...unknown[]]));
  }
}

/** Gated: set ATS_DEBUG_BOOKING_PATH=1 for live path tracing (slot gate, actions). */
function traceBookingPath(tag: string, payload: Record<string, unknown>): void {
  if (process.env.ATS_DEBUG_BOOKING_PATH !== '1' && process.env.ATS_DEBUG_BOOKING_PATH !== 'true') {
    return;
  }
  console.warn(`[v2/engine trace] ${tag}`, JSON.stringify(payload));
}

/**
 * Second-affirm / stray path: after CREATE (or when confirmationPending is false), the model may
 * return REPLY_ONLY / REPLY / CONFIRM_BOOKING instead of SUBMIT_BOOKING — duplicate-affirm guard
 * never runs, but Case 3 would still replace the reply with a confirmation template. Skip that.
 */
function draftHasValidDateTimeForSlotGate(draft: BookingDraft): boolean {
  const date = String(draft.date ?? '').trim();
  const time = String(draft.time ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return false;
  return true;
}

function shouldRunSlotAvailabilityGate(
  finalAction: string,
  finalMergedDraft: BookingDraft,
): boolean {
  if (!draftHasValidDateTimeForSlotGate(finalMergedDraft)) return false;
  if (finalAction === 'CONFIRM_BOOKING' || finalAction === 'MODIFY_BOOKING' || finalAction === 'SUBMIT_BOOKING')
    return true;
  if (
    finalAction === 'COLLECT_BOOKING' &&
    finalMergedDraft.mode === 'modify' &&
    bookingDraftHasAllRequiredSlots(finalMergedDraft)
  ) {
    return true;
  }
  // Fallback: REPLY misclassification with modify/cancel + concrete slot still needs the hard gate.
  if (
    (finalAction === 'REPLY' || finalAction === 'REPLY_ONLY') &&
    (finalMergedDraft.mode === 'modify' || finalMergedDraft.mode === 'cancel')
  ) {
    return true;
  }
  return false;
}

function shouldSkipCase3WhenAffirmingWithoutPending(
  input: AiEngineInput,
  finalMergedDraft: BookingDraft,
  finalAction: string,
): boolean {
  if (input.signals?.confirmationPending) return false;
  const mode = finalMergedDraft.mode;
  if (mode === 'modify' || mode === 'cancel') return false;
  if (!bookingDraftHasAllRequiredSlots(finalMergedDraft)) return false;
  if (!isConfirmationMessage(input.currentMessage)) return false;
  return ['REPLY_ONLY', 'REPLY', 'CONFIRM_BOOKING'].includes(finalAction);
}

const MAX_HISTORY = 10;
const API_TIMEOUT_MS = 60_000;

import { formatDateHKYmd, getHKTJsWeekday, getHKTToday } from './date-utils';

export { getHKTToday, formatDateHKYmd };

const EMPTY_DRAFT: BookingDraft = {
  bookingId: null,
  mode: null,
  serviceName: null,
  serviceDisplayName: null,
  date: null,
  time: null,
  customerName: null,
  phone: null,
};

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
    bookingLookupEmpty: input.bookingLookupEmpty,
    bookingLookupPhone: input.bookingLookupPhone,
    activeBookingId: input.activeBookingId ?? input.bookingDraft?.bookingId ?? null,
  };
}

/** Maps LLM `newSlots.date` / `newSlots.time` (fallback: merged draft) → `changes.startTime` ISO for persistence. */
function buildModifyChangesFromDraft(
  merged: BookingDraft,
  newSlots: Partial<BookingDraft>,
): SideEffectBookingChanges {
  const changes: SideEffectBookingChanges = {};
  if (newSlots.serviceName !== undefined && merged.serviceName) {
    changes.serviceName = merged.serviceName;
  }
  const date = newSlots.date ?? merged.date;
  const time = newSlots.time ?? merged.time;
  if (date && time) {
    try {
      changes.startTime = buildBookingDateTime(date, time).toISOString();
    } catch {
      /* ignore invalid slot combo */
    }
  }
  return changes;
}

/**
 * V2 side effects for persistence (CREATE / MODIFY / CANCEL booking).
 * SUBMIT_BOOKING → CREATE_BOOKING is the only path that writes a new booking row.
 *
 * MODIFY_BOOKING / CANCEL_BOOKING:
 * - `bookingId` = merged draft (includes LLM `newSlots.bookingId`) → then `newSlots.bookingId` → then `ctx.activeBookingId` (from input).
 * - MODIFY `changes.startTime` = ISO string from `newSlots.date|draft.date` + `newSlots.time|draft.time` via `buildBookingDateTime` (see `buildModifyChangesFromDraft`).
 */
function buildSideEffects(
  finalAction: string,
  draft: BookingDraft,
  newSlots: Partial<BookingDraft>,
  ctx: PromptContext,
): SideEffect[] {
  const effects: SideEffect[] = [];

  if (finalAction === 'SUBMIT_BOOKING') {
    const hasService = !!(draft.serviceName?.trim() || draft.serviceDisplayName?.trim());
    if (hasService && draft.date && draft.time) {
      let startTime: string;
      try {
        startTime = buildBookingDateTime(draft.date, draft.time).toISOString();
      } catch {
        startTime = `${draft.date}T${draft.time}:00`;
      }
      const serviceName = (draft.serviceDisplayName ?? draft.serviceName ?? '').trim();
      const customerName = draft.customerName?.trim() ? draft.customerName.trim() : null;
      const phone = draft.phone?.trim() ? draft.phone.trim() : null;
      effects.push({
        type: 'CREATE_BOOKING',
        data: {
          serviceName,
          startTime,
          customerName,
          phone,
        },
      });
    } else {
      console.warn('[v2/engine] SUBMIT_BOOKING but draft incomplete — no side effect', {
        serviceName: draft.serviceName,
        serviceDisplayName: draft.serviceDisplayName,
        date: draft.date,
        time: draft.time,
      });
    }
    return effects;
  }

  const bookingId =
    (draft.bookingId && String(draft.bookingId).trim()) ||
    (newSlots.bookingId && String(newSlots.bookingId).trim()) ||
    (ctx.activeBookingId && String(ctx.activeBookingId).trim()) ||
    undefined;
  if (!bookingId) return effects;

  if (finalAction === 'CANCEL_BOOKING') {
    effects.push({ type: 'CANCEL_BOOKING', bookingId });
    return effects;
  }

  if (finalAction === 'MODIFY_BOOKING') {
    const changes = buildModifyChangesFromDraft(draft, newSlots);
    effects.push({ type: 'MODIFY_BOOKING', bookingId, changes });
  }

  return effects;
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

/* ── Bug 2 fix：如果 LLM 冇填 serviceName 但 reply 或 user message 提到已知服務，自動補上 ── */
function inferMissingService(
  newSlots: Partial<BookingDraft>,
  mergedDraft: BookingDraft,
  replyText: string,
  knowledge: unknown[],
  userMessage?: string,
): Partial<BookingDraft> {
  if (mergedDraft.serviceName || newSlots.serviceName) return newSlots;

  // Build service catalog from knowledge chunks (title + aliases)
  const catalog: ServiceEntry[] = [];
  for (const chunk of knowledge) {
    const c = chunk as Record<string, unknown>;
    const title = typeof c.title === 'string' ? c.title.trim() : '';
    const aliases = Array.isArray(c.aliases) ? c.aliases : [];
    if (title) {
      catalog.push({
        code: title,
        displayName: title,
        aliases: [...aliases, title],
        priceInfo: null,
        fullInfo: '',
      });
    }
  }

  // Search in reply text AND user message
  const searchTexts = [replyText];
  if (userMessage) searchTexts.push(userMessage);

  const result = matchService(searchTexts.join(' '), catalog);
  if ((result.type === 'exact' || result.type === 'close') && result.matches.length > 0) {
    const best = result.matches[0];
    debugLog(`[v2/engine] Auto-inferred missing serviceName: ${best.service.displayName}`);
    return {
      ...newSlots,
      serviceName: best.service.code,
      serviceDisplayName: best.service.displayName,
    };
  }

  return newSlots;
}

/**
 * Fallback: deterministically extract service / date / time from the user message
 * so slots don't silently disappear. Only fills slots that are missing in the merged draft.
 */
function deterministicSlotFallback(
  userMessage: string,
  newSlots: Partial<BookingDraft>,
  mergedDraft: BookingDraft,
  knowledge: unknown[],
): Partial<BookingDraft> {

  const patched = { ...newSlots };
  let changed = false;

  if (!mergedDraft.serviceName) {
    const catalog: ServiceEntry[] = [];
    for (const chunk of knowledge) {
      const c = chunk as Record<string, unknown>;
      const title = typeof c.title === 'string' ? c.title.trim() : '';
      if (title) {
        catalog.push({
          code: title,
          displayName: title,
          aliases: [title],
          priceInfo: null,
          fullInfo: '',
        });
      }
    }
    if (catalog.length > 0) {
      const result = matchService(userMessage, catalog);
      if ((result.type === 'exact' || result.type === 'close') && result.matches.length > 0) {
        const best = result.matches[0];
        patched.serviceName = best.service.code;
        patched.serviceDisplayName = best.service.displayName;
        changed = true;
        debugLog(`[v2/engine] Fallback: extracted service "${best.service.displayName}" from user message`);
      }
    }
  }

  const extracted = extractSlots(userMessage);
  if (!mergedDraft.date && extracted.date) {
    patched.date = extracted.date;
    changed = true;
    debugLog(`[v2/engine] Fallback: extracted date "${extracted.date}" from user message`);
  }
  if (!mergedDraft.time && extracted.time) {
    patched.time = extracted.time;
    changed = true;
    debugLog(`[v2/engine] Fallback: extracted time "${extracted.time}" from user message`);
  }
  if (!mergedDraft.customerName && extracted.customerName) {
    patched.customerName = extracted.customerName;
    changed = true;
  }
  if (!mergedDraft.phone && extracted.phone) {
    patched.phone = extracted.phone;
    changed = true;
  }

  if (changed) {
    debugLog('[v2/engine] Fallback slots applied:', JSON.stringify(patched));
  }
  return patched;
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

  debugLog('[v2/engine] Regex extracted reply:', extractedReply);
  debugLog('[v2/engine] Regex extracted slots:', JSON.stringify(slots));

  return {
    thinking: '',
    reply: extractedReply,
    intent: (intentMatch?.[1] ?? 'OTHER') as AiIntent,
    action: (actionMatch?.[1] ?? 'REPLY') as AiAction,
    newSlots: slots,
  };
}

/** @deprecated Use formatDateHKYmd from date-utils — kept for external scripts/tests. */
export function formatHongKongYmd(d: Date): string {
  return formatDateHKYmd(d);
}

function getHongKongDayOfWeekIndex(d: Date): number {
  return getHKTJsWeekday(d);
}

export function resolveRelativeDates(text: string, today?: Date): string | null {
  const d = today ?? getHKTToday();
  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const dow = getHongKongDayOfWeekIndex(d);

  function addDays(base: Date, n: number): Date {
    const r = new Date(base);
    r.setDate(base.getDate() + n);
    return r;
  }
  function fmtResult(label: string, target: Date): string {
    const ymd = formatHongKongYmd(target);
    const hkDow = getHongKongDayOfWeekIndex(target);
    return `${label} = ${ymd}（星期${dayLabels[hkDow]}）`;
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
  if (/大後日|大后日/.test(text)) {
    results.push(fmtResult('大後日', addDays(d, 3)));
  } else if (/後日|後天/.test(text)) {
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
    if (input.knowledge.length > 0 && messages.length > 0 && messages[0].role === 'system') {
      const systemPrompt = String(messages[0].content ?? '');
      const hasAnyKbChunk = input.knowledge.some((k) => {
        const title = (k.title ?? '').trim();
        if (title && systemPrompt.includes(title)) return true;
        const contentHead = (k.content ?? '').trim().slice(0, 20);
        return contentHead.length > 0 && systemPrompt.includes(contentHead);
      });
      if (!hasAnyKbChunk) {
        console.warn('[V2] KB chunks retrieved but not injected into prompt');
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
      debugLog('[v2/engine] Injected date hint into user message:', resolvedDates);
    }

    debugLog(`[v2/engine] Sending ${messages.length} messages to OpenAI (trimmed to last ${MAX_HISTORY})`);
    debugLog('[v2/engine] Messages payload:', JSON.stringify(messages, null, 2));

    const client = new OpenAI({ timeout: API_TIMEOUT_MS, maxRetries: 0 });
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const MAX_RETRIES = 1;
    let response: OpenAI.Chat.Completions.ChatCompletion | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        debugLog(`[v2/engine] OpenAI request attempt ${attempt + 1} with timeout ${API_TIMEOUT_MS / 1000}s`);
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
        debugLog('[v2/engine] Retry attempt', attempt + 1, 'after error:', (err as Error).message, `(waiting ${delay}ms)`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (!response) throw new Error('No response from OpenAI after retries');

    const finishReason = response.choices[0]?.finish_reason;
    const content = response.choices[0]?.message?.content;

    debugLog('[v2/engine] Finish reason:', finishReason);
    debugLog('[v2/engine] Content type:', typeof content);
    debugLog('[v2/engine] Content length:', content?.length);
    debugLog('[v2/engine] Content preview:', typeof content === 'string' ? content.substring(0, 500) : String(content));
    debugLog('[v2/engine] Usage:', JSON.stringify(response.usage));

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      console.error('[v2/engine] Empty or invalid response from OpenAI. Type:', typeof content, 'Value:', JSON.stringify(content));
      return buildFallbackResult(Date.now() - start);
    }

    const rawText = content.trim();
    debugLog('[v2/engine] Raw LLM response:', rawText);

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

    const validated = validateOutput(normalized, {
      ...ctx,
      confirmationPending: !!input.signals?.confirmationPending,
    });

    if (validated.validationIssues.length > 0) {
      console.warn('[v2/engine] Validation issues:', validated.validationIssues);
    }

    /* Bug 2 fix：自動補漏 serviceName — also search user message, not just reply */
    let finalNewSlots = inferMissingService(
      validated.newSlots,
      validated.mergedDraft,
      normalized.replyText,
      input.knowledge,
      input.currentMessage,
    );

    // Fallback: extract remaining slots deterministically from user message
    // when LLM didn't fill all fields (covers REPLY, REPLY_ONLY, COLLECT_BOOKING)
    const mergedAfterInfer = mergeBookingDraft(validated.mergedDraft, finalNewSlots);
    if (
      (validated.action === 'REPLY' || validated.action === 'REPLY_ONLY' || validated.action === 'COLLECT_BOOKING') &&
      getMissingBookingSlots(mergedAfterInfer).length > 0
    ) {
      const fallbackSlots = deterministicSlotFallback(
        input.currentMessage,
        finalNewSlots,
        mergedAfterInfer,
        input.knowledge,
      );
      // Only fill missing fields; never overwrite LLM-extracted slots
      finalNewSlots = {
        ...finalNewSlots,
        serviceName: finalNewSlots.serviceName ?? fallbackSlots.serviceName,
        serviceDisplayName: finalNewSlots.serviceDisplayName ?? fallbackSlots.serviceDisplayName,
        date: finalNewSlots.date ?? fallbackSlots.date,
        time: finalNewSlots.time ?? fallbackSlots.time,
        customerName: finalNewSlots.customerName ?? fallbackSlots.customerName,
        phone: finalNewSlots.phone ?? fallbackSlots.phone,
      };
    }

    // Deterministic slot rescue for CONFIRM_BOOKING with missing fields.
    // Before downgrading to COLLECT_BOOKING, try extracting from the user message
    // so partial LLM newSlots (e.g. only date+time, missing customerName) get patched.
    const mergedBeforeRescue = mergeBookingDraft(validated.mergedDraft, finalNewSlots);
    const missingBeforeRescue = getMissingBookingSlots(mergedBeforeRescue);

    if (
      validated.action === 'CONFIRM_BOOKING' &&
      missingBeforeRescue.length > 0
    ) {
      const rescueSlots = deterministicSlotFallback(
        input.currentMessage,
        finalNewSlots,
        mergedBeforeRescue,
        input.knowledge,
      );
      if (Object.keys(rescueSlots).some((k) => rescueSlots[k as keyof typeof rescueSlots] != null)) {
        // Only fill missing fields; never overwrite LLM-extracted slots
        finalNewSlots = {
          ...finalNewSlots,
          serviceName: finalNewSlots.serviceName ?? rescueSlots.serviceName,
          serviceDisplayName: finalNewSlots.serviceDisplayName ?? rescueSlots.serviceDisplayName,
          date: finalNewSlots.date ?? rescueSlots.date,
          time: finalNewSlots.time ?? rescueSlots.time,
          customerName: finalNewSlots.customerName ?? rescueSlots.customerName,
          phone: finalNewSlots.phone ?? rescueSlots.phone,
          bookingId: finalNewSlots.bookingId ?? rescueSlots.bookingId,
        };
        debugLog('[v2/engine] CONFIRM_BOOKING rescue: patched slots from user message:', JSON.stringify(rescueSlots));
      }
    }

    const finalMergedDraft = mergeBookingDraft(validated.mergedDraft, finalNewSlots);

    // ── Explicit override: ensure finalNewSlots.serviceName writes through ──
    // mergeBookingDraft uses ?? which may not override when orNull() treats
    // some LLM outputs as null. Write back explicitly so the draft always
    // reflects the LLM's extracted service when one exists.
    if (finalNewSlots.serviceName) {
      finalMergedDraft.serviceName = finalNewSlots.serviceName;
      finalMergedDraft.serviceDisplayName =
        finalNewSlots.serviceDisplayName ?? finalNewSlots.serviceName;
    }

    // ── Service switch detection: clear or replace serviceName when user switches ──
    const switchCatalog = buildServiceCatalog(input.knowledge);
    const switchTaxonomy = buildServiceTaxonomy(switchCatalog);
    const serviceSwitch = detectServiceSwitch(
      input.currentMessage, finalMergedDraft, finalNewSlots, switchCatalog, switchTaxonomy,
    );
    if (serviceSwitch) {
      if (serviceSwitch.type === 'clear') {
        finalMergedDraft.serviceName = null;
        finalMergedDraft.serviceDisplayName = null;
        console.log('[v2/engine] Service switch: cleared serviceName (category-level reference)');
      } else {
        finalMergedDraft.serviceName = serviceSwitch.serviceName!;
        finalMergedDraft.serviceDisplayName = serviceSwitch.serviceDisplayName!;
        console.log(`[v2/engine] Service switch: replaced with ${serviceSwitch.serviceDisplayName}`);
      }
    }

    const missingSlots = getMissingBookingSlots(finalMergedDraft);

    let finalAction = validated.action as string;

    if (validated.action === 'CONFIRM_BOOKING' && missingSlots.length > 0) {
      console.log('[v2/engine] CONFIRM_BOOKING but missing:', missingSlots);

      validated.action = 'COLLECT_BOOKING';

      let fixedReply = validated.validatedReply
        .replace(/[，。、]?\s*確認嗎[？?]?/g, '')
        .replace(/[，。、]?\s*confirm\s*\??/gi, '')
        .trim();

      const slotLabel: Record<string, string> = {
        phone: '電話號碼',
        customerName: '姓名',
        serviceName: '想預約嘅服務',
        date: '日期',
        time: '時間',
      };
      const askFor = missingSlots.map((s) => slotLabel[s] ?? s).join('、');
      fixedReply += fixedReply.endsWith('。') ? '' : '。';
      fixedReply += `請問你嘅${askFor}係？`;

      validated.validatedReply = fixedReply;
      debugLog('[v2/engine] Reply fixed for missing slots:', fixedReply);
    }

    finalAction = validated.action as string;

    if (finalAction === 'SUBMIT_BOOKING' && missingSlots.length > 0) {
      console.log('[v2/engine] SUBMIT_BOOKING but missing:', missingSlots);
      finalAction = 'COLLECT_BOOKING';
    }
    // Cancel: require an explicit cancel-confirmation turn (confirmationPending) before CANCEL_BOOKING side effect.
    if (
      finalAction === 'CANCEL_BOOKING' &&
      finalMergedDraft.mode === 'cancel' &&
      !input.signals?.confirmationPending &&
      input.currentMessage &&
      !isConfirmationMessage(input.currentMessage)
    ) {
      finalAction = 'CONFIRM_BOOKING';
      console.warn(
        '[v2/engine] Deferred CANCEL_BOOKING: awaiting cancel confirmation (no prior confirmationPending)',
      );
    }
    // Pass through MODIFY_BOOKING and CANCEL_BOOKING as-is
    if (finalAction === 'MODIFY_BOOKING' || finalAction === 'CANCEL_BOOKING') {
      // These don't need slot validation — bookingId is validated by validator.ts
    }

    // ── Robust guard: no confirmation-summary wording until all required slots exist ──
    let finalReply = validated.validatedReply;
    {
      const prematureConfirm =
        missingSlots.length > 0 &&
        (/確認嗎|確認？|確認\?|confirm/i.test(finalReply) || replyHasConfirmationSummary(finalReply));
      if (prematureConfirm) {
        const labelMap: Record<string, string> = {
          serviceName: '服務',
          date: '日期',
          time: '時間',
          customerName: '姓名',
          phone: '電話',
        };
        const missingLabels = missingSlots.map((k) => labelMap[k] || k).join('、');
        if (replyHasConfirmationSummary(finalReply)) {
          finalReply = '收到！';
        } else {
          finalReply = finalReply
            .replace(/[。，,]?\s*確認嗎[？?]?/g, '')
            .replace(/[。，,]?\s*OK嗎[？?]?/gi, '')
            .replace(/[。，,]?\s*確認[？?]/g, '')
            .trim();
          if (!finalReply) finalReply = '收到！';
        }
        finalReply += ` 請提供你嘅${missingLabels}。`;
        finalAction = 'COLLECT_BOOKING';
        console.log('[v2/engine] Guard: stripped premature confirmation, missing:', missingLabels);
      }
    }

    const preBoundaryAudit: AuditPreBoundarySnapshot = {
      finalReplyBeforeBoundary: finalReply,
      finalActionBeforeBoundary: finalAction,
      mergedDraftBeforeBoundary: finalMergedDraft,
      confirmationPendingIn: !!input.signals?.confirmationPending,
      currentMessageIn: input.currentMessage,
    };

    {
      const duplicateAffirmGuard = validated.validationIssues.includes(DUPLICATE_AFFIRM_GUARD_ISSUE);
      const affirmWithoutPendingCase3 = shouldSkipCase3WhenAffirmingWithoutPending(
        input,
        finalMergedDraft,
        finalAction,
      );
      const skipCase3Template = duplicateAffirmGuard || affirmWithoutPendingCase3;
      if (affirmWithoutPendingCase3 && !duplicateAffirmGuard) {
        console.warn(
          '[v2/engine] Skip Case 3 template: affirmation without confirmationPending (non-SUBMIT path; e.g. REPLY/CONFIRM after duplicate turn)',
        );
      }
      const boundary = applyConfirmationBoundaryPostProcess(finalMergedDraft, finalReply, finalAction, {
        currentMessage: input.currentMessage,
        confirmationPending: !!input.signals?.confirmationPending,
        skipDeterministicConfirmationTemplate: skipCase3Template,
      });
      finalReply = boundary.reply;
      finalAction = boundary.action;
      if (boundary.usedTemplate) {
        console.warn('[v2/engine] Confirmation boundary (Case 3): deterministic summary + CONFIRM_BOOKING');
      }
    }

    let slotAvailabilityBlocked = false;
    {
      const gateWouldRun = shouldRunSlotAvailabilityGate(finalAction, finalMergedDraft);
      traceBookingPath('slotGate.check', {
        finalActionPreGate: finalAction,
        mode: finalMergedDraft.mode ?? null,
        gateWouldRun,
        date: String(finalMergedDraft.date ?? '').trim() || null,
        time: String(finalMergedDraft.time ?? '').trim() || null,
        draftNameSet: Boolean(finalMergedDraft.customerName?.trim()),
      });
      if (gateWouldRun) {
        const policy = buildSlotPolicyFromTenantSettings(input.tenant.settings ?? {});
        const gate = validateBookingSlot({
          date: String(finalMergedDraft.date ?? '').trim(),
          time: String(finalMergedDraft.time ?? '').trim(),
          service: finalMergedDraft.serviceName ?? finalMergedDraft.serviceDisplayName ?? null,
          timeZone: policy.timeZone,
          businessHours: policy.businessHours,
          closedDays: policy.closedDays,
          bookingPolicy: policy.bookingPolicy,
          calendarAvailability: null,
          now: new Date(),
        });
        traceBookingPath('slotGate.result', {
          allowed: gate.allowed,
          code: gate.code,
          reason: gate.reason?.slice(0, 200) ?? '',
          timeZone: policy.timeZone,
          hasBusinessHours: policy.businessHours != null,
        });
        if (!gate.allowed) {
          slotAvailabilityBlocked = true;
          finalAction = 'COLLECT_BOOKING';
          const extra = gate.suggestedAlternatives?.trim();
          finalReply = [gate.reason.trim(), extra].filter(Boolean).join(' ');
          console.warn('[v2/engine] Slot availability gate blocked:', gate.code);
        }
        traceBookingPath('slotGate.after', {
          slotAvailabilityBlocked,
          finalActionPostGate: finalAction,
        });
      }
    }

    const finalLegacyAction = mapActionToLegacy(finalAction);

    const sideEffects = buildSideEffects(finalAction, finalMergedDraft, finalNewSlots, ctx);

    const modifySummaryAwaitingAffirm =
      !slotAvailabilityBlocked &&
      finalMergedDraft.mode === 'modify' &&
      !!String(finalMergedDraft.bookingId ?? '').trim() &&
      bookingDraftHasAllRequiredSlots(finalMergedDraft) &&
      finalAction === 'COLLECT_BOOKING';

    const result: AiEngineResult & { _rawLlmJson?: string } = {
      replyText: finalReply,
      signals: {
        intents: [validated.intent as AiIntent],
        extractedFields: buildExtractedFields(finalNewSlots),
        action: finalLegacyAction,
        bookingDraft: finalMergedDraft,
        confirmationPending:
          !slotAvailabilityBlocked && (finalAction === 'CONFIRM_BOOKING' || modifySummaryAwaitingAffirm),
        slotAvailabilityBlocked: slotAvailabilityBlocked || undefined,
        _auditPreBoundary: preBoundaryAudit,
      },
      sideEffects,
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
    traceBookingPath('return', {
      intent: validated.intent,
      finalV2Action: finalAction,
      legacyAction: finalLegacyAction,
      slotAvailabilityBlocked,
    });
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