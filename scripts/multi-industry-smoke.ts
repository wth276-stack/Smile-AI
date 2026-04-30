/**
 * Multi-industry smoke: beauty | cleaning | yoga against POST /api/chat/public.
 *
 * Validates KB + booking flow per vertical with industry-specific phrases;
 * assertions stay generic (no hardcoded SKU prices).
 *
 * Prereqs:
 * - API running (e.g. API_BASE=http://localhost:3002)
 * - root .env: DATABASE_URL (+ OPENAI on server)
 * - demo tenants for cleaning & yoga with KB: `pnpm run demo:ensure:phase2a` (does not touch beauty `demo-tenant`)
 * - pacing: default ~6.2s between chat calls to avoid ThrottlerGuard (10/min); override with SMOKE_INDUSTRY_CHAT_PAUSE_MS=0 for fast local runs if limit is off
 * - booking slots: rolling HK Sat 11:00 + following Mon 15:00 (see smoke-booking-dates.ts); SMOKE_BOOKING_MIN_LEAD_DAYS overrides minimum lead days (default 14)
 *
 *   API_BASE=http://localhost:3002 pnpm run smoke:industries
 *
 * PowerShell: use `;` to chain commands (not `&&` on older PS).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { prisma, getDemoTenantIdForIndustryId } from '../packages/database/src/index';
import { getSmokeBookingDateBundle, type SmokeBookingDateBundle } from './smoke-booking-dates';
import { replyAppearsToQuotePrice } from './smoke-price-assert';

config({ path: resolve(process.cwd(), '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:3002';
/** Pace requests to satisfy ThrottlerGuard on public-chat (default 10 / 60s). */
const CHAT_PAUSE_MS = Math.max(
  0,
  Number.parseInt(process.env.SMOKE_INDUSTRY_CHAT_PAUSE_MS ?? '6200', 10) || 0,
);
let lastChatRequestAt = 0;

async function pacePublicChatThrottle(): Promise<void> {
  if (CHAT_PAUSE_MS <= 0) return;
  const now = Date.now();
  const elapsed = now - lastChatRequestAt;
  const wait = Math.max(0, CHAT_PAUSE_MS - elapsed);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const PHASE_2A_INDUSTRY_IDS = ['beauty', 'cleaning', 'yoga'] as const;
type Phase2AIndustryId = (typeof PHASE_2A_INDUSTRY_IDS)[number];

type PublicChatResponse = {
  reply: string;
  conversationId: string;
  contactId: string;
  sideEffects?: Array<{ type?: string }>;
  sideEffectFailures?: unknown[];
  enginePath?: string;
  fallbackReason?: string;
};

type RawMeta = {
  reply?: string;
  action?: string;
  intent?: string;
  newSlots?: Record<string, unknown>;
};

type TurnResult = PublicChatResponse & {
  raw: RawMeta | null;
};

type CaseResult = {
  id: string;
  industryId: Phase2AIndustryId;
  title: string;
  ok: boolean;
  notes: string[];
};

const INDUSTRY_PHRASES: Record<
  Phase2AIndustryId,
  {
    priceMessage: string;
    faqMessage: string;
    recommendMessage: string;
    unknownPriceMessage: string;
    /** If this appears paired with a concrete price pattern, smoke fails (Kb-only pricing). */
    unknownServiceSnippet: string;
    bookingIntentMessage: string;
  }
> = {
  beauty: {
    priceMessage: 'HIFU 幾錢？效果可以維持幾耐？',
    faqMessage: '你哋地址喺邊？可以點付款？',
    recommendMessage: '我面有啲鬆，想提升輪廓，有咩推介？',
    unknownPriceMessage: '你哋有冇牙齒美白？幾錢？',
    unknownServiceSnippet: '牙齒美白',
    bookingIntentMessage: '我想預約深層清潔 Facial',
  },
  cleaning: {
    priceMessage: '全屋深層清潔幾錢？',
    faqMessage: '你哋包唔包清潔用品？服務範圍去邊？',
    recommendMessage: '冷氣機清洗係點做？大概幾耐？',
    unknownPriceMessage: '你哋有冇大理石拋光打蠟？幾錢？',
    unknownServiceSnippet: '大理石',
    bookingIntentMessage: '我想預約全屋深層清潔',
  },
  yoga: {
    priceMessage: '私人瑜珈課幾錢？',
    faqMessage: '第一堂有冇體驗價？要帶咩？',
    recommendMessage: '想了解更多私人瑜珈課內容，適合初學者嗎？',
    unknownPriceMessage: '你哋有冇泰拳速成班？幾錢？',
    unknownServiceSnippet: '泰拳',
    bookingIntentMessage: '我想預約私人瑜珈課',
  },
};

function fail(notes: string[], message: string) {
  notes.push(`FAIL: ${message}`);
}

function warn(notes: string[], message: string) {
  notes.push(`WARN: ${message}`);
}

function pass(notes: string[], message: string) {
  notes.push(`PASS: ${message}`);
}

function compactReply(reply: string): string {
  return reply.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function hasEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}|\uFE0F/u.test(text);
}

async function getLastAiPayload(conversationId: string): Promise<RawMeta | null> {
  const msg = await prisma.message.findFirst({
    where: { conversationId, sender: 'AI' },
    orderBy: { createdAt: 'desc' },
  });
  const meta = msg?.metadata as { rawLlmJson?: string } | null;
  if (!meta?.rawLlmJson) return null;
  try {
    return JSON.parse(meta.rawLlmJson) as RawMeta;
  } catch {
    return null;
  }
}

async function postPublic(
  industryId: Phase2AIndustryId,
  message: string,
  conversationId?: string,
): Promise<TurnResult> {
  await pacePublicChatThrottle();
  lastChatRequestAt = Date.now();
  const response = await fetch(`${API_BASE}/api/chat/public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      industryId,
      message,
      ...(conversationId ? { conversationId } : {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  const json = JSON.parse(text) as PublicChatResponse;
  const raw = await getLastAiPayload(json.conversationId);
  return { ...json, raw };
}

function validateBasic(turn: TurnResult, notes: string[]) {
  if (!turn.reply?.trim()) fail(notes, 'empty reply');
  if (hasEmoji(turn.reply)) fail(notes, `reply contains emoji/decorative pictograph: ${turn.reply}`);
  if (turn.reply.length > 350) warn(notes, `reply is long (${turn.reply.length} chars)`);
  const action = turn.raw?.action;
  const lineCount = turn.reply.split(/\r?\n/).filter((line) => line.trim()).length;
  if (action === 'CONFIRM_BOOKING' && lineCount > 5) {
    fail(notes, `booking confirmation is ${lineCount} lines, expected <= 5`);
  }
  if (
    (action === 'SUBMIT_BOOKING' || action === 'MODIFY_BOOKING' || action === 'CANCEL_BOOKING') &&
    lineCount > 2
  ) {
    fail(notes, `${action} success reply is ${lineCount} lines, expected <= 2`);
  }
  if ((turn.sideEffectFailures ?? []).length > 0) {
    fail(notes, `sideEffectFailures=${JSON.stringify(turn.sideEffectFailures)}`);
  }
  if (turn.fallbackReason) warn(notes, `fallbackReason=${turn.fallbackReason}`);
}

function hasEffect(turn: TurnResult, type: string): boolean {
  return (turn.sideEffects ?? []).some((effect) => effect.type === type);
}

function formatHkYmdHm(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

async function auditTenantKb(industryId: Phase2AIndustryId, tenantId: string): Promise<void> {
  const [svc, faq] = await Promise.all([
    prisma.knowledgeDocument.count({
      where: { tenantId, isActive: true, docType: 'SERVICE' },
    }),
    prisma.knowledgeDocument.count({
      where: { tenantId, isActive: true, docType: 'FAQ' },
    }),
  ]);
  console.log(`  [audit] ${industryId} tenant=${tenantId} SERVICE=${svc} FAQ=${faq}`);
  if (svc === 0) console.warn(`  [audit] WARN: ${industryId} has no active SERVICE rows`);
  if (faq === 0) console.warn(`  [audit] WARN: ${industryId} has no active FAQ rows`);
}

async function singleTurnCase(
  industryId: Phase2AIndustryId,
  id: string,
  title: string,
  message: string,
  inspect: (turn: TurnResult, notes: string[]) => void,
): Promise<CaseResult> {
  const notes: string[] = [];
  try {
    const turn = await postPublic(industryId, message);
    validateBasic(turn, notes);
    inspect(turn, notes);
  } catch (err) {
    fail(notes, err instanceof Error ? err.message : String(err));
  }
  return { id, industryId, title, ok: !notes.some((n) => n.startsWith('FAIL:')), notes };
}

async function bookingLifecycleCase(
  industryId: Phase2AIndustryId,
  tenantId: string,
  bookingIntentMessage: string,
  dates: SmokeBookingDateBundle,
): Promise<CaseResult> {
  const id = 'S5';
  const title = 'booking create, modify, cancel lifecycle';
  const notes: string[] = [];
  let conversationId: string | undefined;

  async function send(message: string) {
    const turn = await postPublic(industryId, message, conversationId);
    conversationId = turn.conversationId;
    validateBasic(turn, notes);
    return turn;
  }

  try {
    await send(bookingIntentMessage);
    await send(dates.userCreateSlotsLineCantonese);
    const created = await send('確認');
    if (hasEffect(created, 'CREATE_BOOKING')) {
      pass(notes, 'booking create side effect fired');
    } else {
      fail(notes, `CREATE_BOOKING missing; action=${created.raw?.action ?? 'unknown'}`);
    }

    await send(dates.userModifyLineCantonese);
    const modified = await send('確認');
    if (hasEffect(modified, 'MODIFY_BOOKING')) {
      pass(notes, 'booking modify side effect fired');
      const booking = await prisma.booking.findFirst({
        where: { tenantId, contactId: modified.contactId },
        orderBy: { updatedAt: 'desc' },
      });
      const actual = booking ? formatHkYmdHm(booking.startTime) : 'missing';
      if (actual === dates.expectedDbAfterModify) {
        pass(notes, `booking row changed to requested ${dates.expectedDbAfterModify}`);
      } else {
        fail(notes, `booking row time is ${actual}, expected ${dates.expectedDbAfterModify}`);
      }
    } else {
      fail(notes, `MODIFY_BOOKING missing; action=${modified.raw?.action ?? 'unknown'}`);
    }

    await send('取消呢個booking');
    const cancelled = await send('確認取消');
    if (hasEffect(cancelled, 'CANCEL_BOOKING')) {
      pass(notes, 'booking cancel side effect fired');
    } else {
      fail(notes, `CANCEL_BOOKING missing; action=${cancelled.raw?.action ?? 'unknown'}`);
    }
  } catch (err) {
    fail(notes, err instanceof Error ? err.message : String(err));
  }

  return { id, industryId, title, ok: !notes.some((n) => n.startsWith('FAIL:')), notes };
}

async function runIndustry(
  industryId: Phase2AIndustryId,
  bookingDates: SmokeBookingDateBundle,
): Promise<CaseResult[]> {
  const tenantId = getDemoTenantIdForIndustryId(industryId);
  if (!tenantId) {
    return [
      {
        id: 'INIT',
        industryId,
        title: 'resolve demo tenant',
        ok: false,
        notes: [`FAIL: No demo tenant for industryId=${industryId}`],
      },
    ];
  }

  console.log(`\n========== Industry: ${industryId} (${tenantId}) ==========`);
  console.log(
    `  [smoke] booking window HK: ${bookingDates.expectedDbAfterCreate} -> ${bookingDates.expectedDbAfterModify}`,
  );
  await auditTenantKb(industryId, tenantId);

  const phrases = INDUSTRY_PHRASES[industryId];
  const results: CaseResult[] = [];

  results.push(
    await singleTurnCase(industryId, 'S1', 'price question', phrases.priceMessage, (turn, notes) => {
      if (replyAppearsToQuotePrice(turn.reply)) pass(notes, 'reply includes currency+amount price cue');
      else fail(notes, `no currency+amount price cue in reply: ${turn.reply}`);
      if (industryId === 'beauty') {
        if (/維持|個月|效果/.test(turn.reply)) pass(notes, 'reply discusses effect duration');
        else warn(notes, 'reply may not answer effect duration');
      }
    }),
  );

  results.push(
    await singleTurnCase(industryId, 'S2', 'FAQ question', phrases.faqMessage, (turn, notes) => {
      if (/暫時未有相關資料|未有資料|聯絡我們了解更多/.test(turn.reply)) {
        fail(notes, `FAQ likely clipped or missing KB: ${turn.reply}`);
      } else {
        pass(notes, 'FAQ answered without missing-info fallback');
      }
    }),
  );

  results.push(
    await singleTurnCase(
      industryId,
      'S3',
      'service recommendation / detail',
      phrases.recommendMessage,
      (turn, notes) => {
        let grounded = false;
        if (industryId === 'beauty') {
          grounded = /HIFU|緊緻|提升|輪廓|療程/.test(turn.reply);
        } else if (industryId === 'cleaning') {
          grounded = /冷氣|清洗|分鐘|部|消毒/.test(turn.reply);
        } else {
          grounded = /瑜珈|瑜伽|私人|課堂|體驗|初學/.test(turn.reply);
        }
        if (grounded) pass(notes, 'reply grounded to relevant services');
        else fail(notes, `recommendation looks ungrounded/weak: ${turn.reply}`);
      },
    ),
  );

  results.push(
    await singleTurnCase(
      industryId,
      'S4',
      'unknown service should not invent price',
      phrases.unknownPriceMessage,
      (turn, notes) => {
        const topic = phrases.unknownServiceSnippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const invented = new RegExp(
          `${topic}.{0,120}(\\$|HKD|HK\\$|\\d+元)|(\\$|HKD|HK\\$)\\s*\\d+.{0,120}${topic}`,
          'i',
        ).test(turn.reply);
        if (invented) fail(notes, `invented unknown-service price: ${turn.reply}`);
        else pass(notes, 'no invented price tied to unknown service keyword');
      },
    ),
  );

  results.push(
    await bookingLifecycleCase(industryId, tenantId, phrases.bookingIntentMessage, bookingDates),
  );

  return results;
}

async function main() {
  const bookingDates = getSmokeBookingDateBundle();
  console.log(`Multi-industry smoke API_BASE=${API_BASE}`);
  console.log(
    `[smoke:industries] HK booking window create=${bookingDates.expectedDbAfterCreate} modify=${bookingDates.expectedDbAfterModify}`,
  );

  const all: CaseResult[] = [];
  for (const industryId of PHASE_2A_INDUSTRY_IDS) {
    all.push(...(await runIndustry(industryId, bookingDates)));
  }

  for (const industryId of PHASE_2A_INDUSTRY_IDS) {
    const subset = all.filter((c) => c.industryId === industryId);
    console.log(`\n--- Summary: ${industryId} ---`);
    for (const result of subset) {
      console.log(`${result.ok ? 'OK' : 'FAIL'} ${result.id} ${result.title}`);
      for (const note of result.notes) console.log(`  - ${note}`);
    }
  }

  const failed = all.filter((r) => !r.ok);
  await prisma.$disconnect();
  if (failed.length > 0) {
    console.error(
      `\nMulti-industry smoke failed: ${failed.map((r) => `${r.industryId}/${r.id}`).join(', ')}`,
    );
    process.exit(1);
  }
  console.log('\nMulti-industry smoke passed (beauty, cleaning, yoga).');
}

main().catch(async (err) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(err);
  process.exit(1);
});
