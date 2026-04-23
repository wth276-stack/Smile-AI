/**
 * Smoke: 5 POSTs to /api/chat/public; prints reply + action + newSlots from Message.metadata.rawLlmJson.
 *
 * Run from repo root:
 *   pnpm exec tsx scripts/public-chat-smoke-5.ts
 * Prereq: API on API_BASE (default http://localhost:3001), USE_V2_ENGINE=1, DATABASE_URL, OPENAI_API_KEY.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { prisma } from '../packages/database/src/client';

config({ path: resolve(process.cwd(), '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const TENANT = process.env.SMOKE_TENANT_ID || 'demo-tenant';

const TESTS: { id: string; input: string }[] = [
  { id: '1', input: 'HIFU 幾錢？效果 can last 幾耐？' },
  { id: '2', input: '我想了解下 laser 祛斑，會唔會好痛？' },
  { id: '3', input: '做 HIFU 要幾耐？' },
  { id: '4', input: 'HIFU 效果通常維持幾耐？' },
  { id: '5', input: '我想 book 9號11點做深層清潔' },
];

type RawMeta = {
  reply?: string;
  action?: string;
  intent?: string;
  newSlots?: Record<string, unknown>;
};

async function getLastAiPayload(conversationId: string): Promise<RawMeta | null> {
  const m = await prisma.message.findFirst({
    where: { conversationId, sender: 'AI' },
    orderBy: { createdAt: 'desc' },
  });
  const meta = m?.metadata as { rawLlmJson?: string } | null;
  if (!meta?.rawLlmJson) return null;
  try {
    return JSON.parse(meta.rawLlmJson) as RawMeta;
  } catch {
    return null;
  }
}

async function postPublic(message: string): Promise<{ reply: string; conversationId: string }> {
  const r = await fetch(`${API_BASE}/api/chat/public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantSlug: TENANT, message }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`HTTP ${r.status}: ${t}`);
  }
  return r.json() as Promise<{ reply: string; conversationId: string }>;
}

async function main() {
  for (const t of TESTS) {
    const res = await postPublic(t.input);
    await new Promise((r) => setTimeout(r, 500));
    const raw = (await getLastAiPayload(res.conversationId)) ?? {};
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          testId: t.id,
          input: t.input,
          reply: res.reply,
          action: raw.action ?? null,
          newSlots: raw.newSlots ?? null,
          conversationId: res.conversationId,
        },
        null,
        2,
      ),
    );
    // eslint-disable-next-line no-console
    console.log('---');
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
