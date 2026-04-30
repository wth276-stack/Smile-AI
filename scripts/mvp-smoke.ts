/**
 * MVP smoke pack for the beauty demo tenant.
 *
 * Runs real HTTP calls against /api/chat/public and inspects the persisted AI
 * metadata so we can catch demo-breaking regressions before sales calls.
 *
 * Prereqs:
 * - API server running on API_BASE, default http://localhost:3001
 * - root .env has DATABASE_URL and OPENAI_API_KEY
 *
 * Run:
 *   pnpm run smoke:mvp
 *
 * Rolling booking dates: see `smoke-booking-dates.ts`. Override lead with SMOKE_BOOKING_MIN_LEAD_DAYS.
 *
 * PowerShell: use `;` to chain commands (not `&&` on older PS).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { prisma } from '../packages/database/src/client';
import { getSmokeBookingDateBundle } from './smoke-booking-dates';
import { replyAppearsToQuotePrice } from './smoke-price-assert';

config({ path: resolve(process.cwd(), '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const INDUSTRY_ID = process.env.SMOKE_INDUSTRY_ID || 'beauty';

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

type SmokeResult = {
  id: string;
  title: string;
  ok: boolean;
  notes: string[];
  turns: TurnResult[];
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

async function postPublic(message: string, conversationId?: string): Promise<TurnResult> {
  const response = await fetch(`${API_BASE}/api/chat/public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      industryId: INDUSTRY_ID,
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

async function singleTurnCase(
  id: string,
  title: string,
  message: string,
  inspect: (turn: TurnResult, notes: string[]) => void,
): Promise<SmokeResult> {
  const notes: string[] = [];
  const turns: TurnResult[] = [];
  try {
    const turn = await postPublic(message);
    turns.push(turn);
    validateBasic(turn, notes);
    inspect(turn, notes);
  } catch (err) {
    fail(notes, err instanceof Error ? err.message : String(err));
  }
  return { id, title, ok: !notes.some((n) => n.startsWith('FAIL:')), notes, turns };
}

async function bookingLifecycleCase(): Promise<SmokeResult> {
  const notes: string[] = [];
  const turns: TurnResult[] = [];
  let conversationId: string | undefined;

  async function send(message: string) {
    const turn = await postPublic(message, conversationId);
    conversationId = turn.conversationId;
    turns.push(turn);
    validateBasic(turn, notes);
    return turn;
  }

  const dates = getSmokeBookingDateBundle();
  pass(notes, `booking window HK: create ${dates.expectedDbAfterCreate}, modify ${dates.expectedDbAfterModify}`);

  try {
    await send('我想預約深層清潔 Facial');
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
        where: { tenantId: 'demo-tenant', contactId: modified.contactId },
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

  return {
    id: 'S5-S7',
    title: 'booking create, modify, cancel lifecycle',
    ok: !notes.some((n) => n.startsWith('FAIL:')),
    notes,
    turns,
  };
}

async function demoResetProtectionCase(): Promise<SmokeResult> {
  const notes: string[] = [];
  const turns: TurnResult[] = [];
  try {
    const before = await prisma.knowledgeDocument.count({
      where: { tenantId: 'demo-tenant', isActive: true },
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.DEMO_ADMIN_TOKEN?.trim()) {
      headers['X-Demo-Admin-Token'] = process.env.DEMO_ADMIN_TOKEN.trim();
    }
    const response = await fetch(`${API_BASE}/api/demo/reset`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ industryId: INDUSTRY_ID }),
    });
    const text = await response.text();
    if (!response.ok) {
      const after = await prisma.knowledgeDocument.count({
        where: { tenantId: 'demo-tenant', isActive: true },
      });
      if (response.status === 401 && before === after && /DEMO_ADMIN_TOKEN/.test(text)) {
        pass(notes, `demo reset endpoint disabled without token; KB preserved (${before} -> ${after})`);
        return {
          id: 'S8',
          title: 'demo reset preserves KB by default',
          ok: true,
          notes,
          turns,
        };
      }
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    const after = await prisma.knowledgeDocument.count({
      where: { tenantId: 'demo-tenant', isActive: true },
    });
    if (before === after && after >= 30) {
      pass(notes, `demo reset preserved KB (${before} -> ${after})`);
    } else {
      fail(notes, `demo reset changed KB count (${before} -> ${after})`);
    }
  } catch (err) {
    fail(notes, err instanceof Error ? err.message : String(err));
  }

  return {
    id: 'S8',
    title: 'demo reset preserves KB by default',
    ok: !notes.some((n) => n.startsWith('FAIL:')),
    notes,
    turns,
  };
}

async function main() {
  const results: SmokeResult[] = [];

  results.push(
    await singleTurnCase('S1', 'price and effect duration', 'HIFU 幾錢？效果可以維持幾耐？', (turn, notes) => {
      if (replyAppearsToQuotePrice(turn.reply)) pass(notes, 'reply includes currency+amount price cue');
      else fail(notes, `no currency+amount price cue in reply: ${turn.reply}`);
      if (/維持|個月|效果/.test(turn.reply)) pass(notes, 'reply discusses effect duration');
      else warn(notes, 'reply may not answer effect duration');
    }),
  );

  results.push(
    await singleTurnCase('S2', 'address and payment FAQ', '你哋地址喺邊？可以點付款？', (turn, notes) => {
      if (/暫時未有相關資料|未有資料|聯絡我們了解更多/.test(turn.reply)) {
        fail(notes, `FAQ likely clipped by top-k: ${turn.reply}`);
      } else {
        pass(notes, 'FAQ answered without missing-info fallback');
      }
    }),
  );

  results.push(
    await singleTurnCase('S3', 'recommendation from need', '我面有啲鬆，想提升輪廓，有咩推介？', (turn, notes) => {
      if (/HIFU|緊緻|提升|輪廓|療程/.test(turn.reply)) pass(notes, 'recommendation grounded to relevant service');
      else fail(notes, `recommendation looks ungrounded/weak: ${turn.reply}`);
    }),
  );

  results.push(
    await singleTurnCase('S4', 'unknown service should not invent', '你哋有冇牙齒美白？幾錢？', (turn, notes) => {
      if (/牙齒美白.*(\$|HKD|HK\$|\d+元)|(\$|HKD|HK\$)\s*\d+.*牙齒美白/.test(turn.reply)) {
        fail(notes, `invented unknown-service price: ${turn.reply}`);
      } else {
        pass(notes, 'no invented price for unknown service');
      }
    }),
  );

  results.push(await bookingLifecycleCase());
  results.push(await demoResetProtectionCase());

  for (const result of results) {
    console.log(`\n${result.ok ? 'OK' : 'FAIL'} ${result.id} ${result.title}`);
    for (const note of result.notes) console.log(`  - ${note}`);
    result.turns.forEach((turn, index) => {
      console.log(
        `  #${index + 1} action=${turn.raw?.action ?? 'n/a'} intent=${turn.raw?.intent ?? 'n/a'} ` +
          `effects=${(turn.sideEffects ?? []).map((e) => e.type).join(',') || '-'} ` +
          `reply=${JSON.stringify(compactReply(turn.reply))}`,
      );
    });
  }

  const failed = results.filter((r) => !r.ok);
  await prisma.$disconnect();
  if (failed.length > 0) {
    console.error(`\nMVP smoke failed: ${failed.map((r) => r.id).join(', ')}`);
    process.exit(1);
  }
  console.log('\nMVP smoke passed.');
}

main().catch(async (err) => {
  await prisma.$disconnect().catch(() => undefined);
  console.error(err);
  process.exit(1);
});
