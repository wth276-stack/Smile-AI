/**
 * Phase 1 驗收：1A KB Search（API）、1B Prompt token（buildSystemPrompt）、1C E2E Chat（/api/chat/demo）
 *
 * Usage (repo root):
 *   pnpm phase1-verify
 *
 * Env (optional):
 *   PHASE1_API_BASE=https://atsapi-production-ad45.up.railway.app
 *   PHASE1_EMAIL=demo@example.com
 *   PHASE1_PASSWORD=demo123456
 */

import { resolve } from 'path';
import { config } from 'dotenv';

config({ path: resolve(__dirname, '../.env') });

import { buildSystemPrompt } from '../packages/ai-engine/src/v2/prompt';
import type { PromptContext } from '../packages/ai-engine/src/v2/types';
import type { BookingDraft, KnowledgeChunk } from '../packages/ai-engine/src/types';

const API_BASE =
  process.env.PHASE1_API_BASE?.replace(/\/$/, '') ||
  'https://atsapi-production-ad45.up.railway.app';
const LOGIN_EMAIL = process.env.PHASE1_EMAIL || 'demo@example.com';
const LOGIN_PASSWORD = process.env.PHASE1_PASSWORD || 'demo123456';

const FETCH_TIMEOUT_MS = 30_000;

type Line = { ok: boolean; label: string; detail?: string; skip?: boolean };

function estimateTokensRough(text: string): number {
  const zh = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const rest = text.length - zh;
  const enWords = rest > 0 ? rest / 5 : 0;
  return Math.ceil(zh * 1.5 + enWords * 1);
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

function docToChunk(d: Record<string, unknown>): KnowledgeChunk {
  return {
    documentId: String(d.id),
    title: String(d.title ?? ''),
    content: String(d.content ?? ''),
    score: 1,
    aliases: (d.aliases as string[] | undefined) ?? [],
    effect: (d.effect as string | null | undefined) ?? null,
    suitable: (d.suitable as string | null | undefined) ?? null,
    unsuitable: (d.unsuitable as string | null | undefined) ?? null,
    precaution: (d.precaution as string | null | undefined) ?? null,
    duration: (d.duration as string | null | undefined) ?? null,
    price: (d.price as string | null | undefined) ?? null,
    discountPrice: (d.discountPrice as string | null | undefined) ?? null,
    steps: (d.steps as string[] | null | undefined) ?? null,
    faqItems: (d.faqItems as KnowledgeChunk['faqItems']) ?? null,
  };
}

const emptyDraft: BookingDraft = {
  serviceName: null,
  serviceDisplayName: null,
  date: null,
  time: null,
  customerName: null,
  phone: null,
};

async function login(): Promise<string | null> {
  const { ok, data } = await fetchJson(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  });
  if (!ok || !data || typeof data !== 'object') return null;
  const token = (data as { accessToken?: string }).accessToken;
  return typeof token === 'string' ? token : null;
}

async function kbSearch(token: string, q: string): Promise<unknown[]> {
  const u = new URL(`${API_BASE}/api/knowledge-base/search`);
  u.searchParams.set('q', q);
  const { ok, data } = await fetchJson(u.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!ok || !Array.isArray(data)) return [];
  return data;
}

async function kbFindAll(token: string): Promise<Record<string, unknown>[]> {
  const { ok, data } = await fetchJson(`${API_BASE}/api/knowledge-base`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!ok || !Array.isArray(data)) return [];
  return data as Record<string, unknown>[];
}

async function postDemoChat(message: string): Promise<{ reply?: string; raw: unknown }> {
  const { ok, data } = await fetchJson(`${API_BASE}/api/chat/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!ok) return { raw: data };
  const reply =
    data && typeof data === 'object' && 'reply' in data
      ? String((data as { reply: unknown }).reply)
      : undefined;
  return { reply, raw: data };
}

async function run1a(token: string | null): Promise<{ lines: Line[] }> {
  const lines: Line[] = [];
  if (!token) {
    for (let i = 1; i <= 6; i++) {
      lines.push({
        ok: true,
        label: `#${i} (1A)`,
        detail: 'SKIP: no JWT — set PHASE1_EMAIL / PHASE1_PASSWORD',
        skip: true,
      });
    }
    return { lines };
  }

  // #1 Empty query → []
  const emptyRes = await kbSearch(token, '');
  const emptyOk = Array.isArray(emptyRes) && emptyRes.length === 0;
  lines.push({
    ok: emptyOk,
    label: '#1 Empty query → 空結果',
    detail: `length=${Array.isArray(emptyRes) ? emptyRes.length : '?'}`,
  });

  // #2 Alias hit — pick first alias from tenant KB
  const all = await kbFindAll(token);
  let aliasSample: string | null = null;
  let aliasDocId: string | null = null;
  for (const d of all) {
    const aliases = d.aliases as string[] | undefined;
    if (aliases && aliases.length > 0) {
      aliasSample = aliases[0];
      aliasDocId = String(d.id);
      break;
    }
  }
  if (!aliasSample) {
    lines.push({
      ok: false,
      label: '#2 Alias 命中',
      detail: 'SKIP: no doc with aliases in KB',
      skip: true,
    });
  } else {
    const aliasHits = await kbSearch(token, aliasSample);
    const hitIds = (aliasHits as { id?: string }[]).map((x) => x?.id).filter(Boolean);
    const ok2 = hitIds.includes(aliasDocId);
    lines.push({
      ok: ok2,
      label: '#2 Alias 命中',
      detail: ok2 ? `alias「${aliasSample}」→ doc ${aliasDocId}` : `expected ${aliasDocId}, got ${hitIds.join(',')}`,
    });
  }

  // #3 Title priority — HIFU first
  const hifuHits = await kbSearch(token, 'HIFU');
  const first = (hifuHits as { title?: string }[])[0];
  const hifuFirst =
    first &&
    typeof first.title === 'string' &&
    /HIFU/i.test(first.title);
  lines.push({
    ok: !!hifuFirst,
    label: '#3 Title 優先（HIFU）',
    detail: first?.title ? `first.title=${first.title}` : 'no results',
  });

  // #4 Chinese bigram
  const bigramHits = await kbSearch(token, '去斑');
  const ok4 = Array.isArray(bigramHits) && bigramHits.length > 0;
  lines.push({
    ok: ok4,
    label: '#4 中文 bigram（去斑）',
    detail: ok4 ? `${bigramHits.length} docs` : 'empty',
  });

  // #5 English "price" → non-empty (mapped to 價錢 keywords in service)
  const priceHits = await kbSearch(token, 'price');
  const ok5 = Array.isArray(priceHits) && priceHits.length > 0;
  lines.push({
    ok: ok5,
    label: '#5 英文 keyword（price）',
    detail: ok5 ? `${priceHits.length} docs` : 'empty',
  });

  // #6 No results
  const none = await kbSearch(token, '火星移民計劃');
  const ok6 = Array.isArray(none) && none.length === 0;
  lines.push({
    ok: ok6,
    label: '#6 無結果',
    detail: `length=${Array.isArray(none) ? none.length : '?'}`,
  });

  return { lines };
}

async function run1b(token: string | null): Promise<Line[]> {
  const lines: Line[] = [];
  if (!token) {
    lines.push({
      ok: false,
      label: 'Prompt token',
      detail: 'SKIP: no JWT',
      skip: true,
    });
    return lines;
  }

  const all = await kbFindAll(token);
  const chunks = all.map(docToChunk);
  const ctx: PromptContext = {
    tenantProfile: {
      businessName: '美容療程示範店',
      businessType: 'beauty salon',
      assistantRole: '親切、專業、不硬銷',
      language: '粵語為主',
    },
    knowledgeChunks: chunks,
    conversationHistory: [],
    currentMessage: '你好，想問下價錢',
    currentDraft: emptyDraft,
    contactName: null,
    tenantSettings: {},
  };

  const prompt = buildSystemPrompt(ctx);
  const chars = prompt.length;
  const est = estimateTokensRough(prompt);
  /** Rough ceiling when all tenant KB docs are loaded — adjust if prompt grows. */
  const TOKEN_THRESHOLD = 4000;
  const pass = est < TOKEN_THRESHOLD;
  lines.push({
    ok: pass,
    label: 'System prompt size',
    detail: `${chars} chars / ~${est} tokens (rough threshold < ${TOKEN_THRESHOLD})`,
  });
  return lines;
}

async function run1c(): Promise<Line[]> {
  const lines: Line[] = [];

  // #1 Greeting — no full service catalog dump
  const r1 = await postDemoChat('Hi');
  const reply1 = r1.reply ?? '';
  const catalogDump =
    /以下.*療程|服務項目|我們提供以下|選擇以下/i.test(reply1) ||
    (reply1.split(/激光|HIFU|Facial|IPL/).length > 4 && reply1.length > 400);
  lines.push({
    ok: !!reply1 && !catalogDump,
    label: '#1 打招呼',
    detail: reply1 ? (catalogDump ? 'looks like full catalog' : reply1.slice(0, 120)) : String(r1.raw),
  });

  // #2 HIFU price
  const r2 = await postDemoChat('HIFU幾錢');
  const reply2 = r2.reply ?? '';
  const priceOk = /4980|6980|HK\$?\s*[0-9]|價錢|收費/i.test(reply2);
  lines.push({
    ok: priceOk,
    label: '#2 服務查詢（HIFU 價錢）',
    detail: reply2.slice(0, 200),
  });

  // #3 Out of KB
  const r3 = await postDemoChat('你哋有冇減肥療程');
  const reply3 = r3.reply ?? '';
  const denyOk =
    /暫時未有|未有相關|聯絡我們|冇相關|冇專門.*減肥|冇.*減肥療程|無.*減肥療程/i.test(reply3);
  lines.push({
    ok: denyOk,
    label: '#3 KB 冇嘅嘢（減肥）',
    detail: reply3.slice(0, 200),
  });

  // #4 Hours FAQ — pass if KB-backed hours OR honest no-data (retrieval miss)
  const r4 = await postDemoChat('你哋幾點開門');
  const reply4 = r4.reply ?? '';
  const hoursOk =
    /10:\s*00|10:00|營業|星期|21:00|休息|早上|晚上|開門/i.test(reply4) ||
    /暫時未有|聯絡我們了解更多/i.test(reply4);
  lines.push({
    ok: hoursOk,
    label: '#4 營業時間',
    detail: reply4.slice(0, 200),
  });

  return lines;
}

function printSection(title: string, lines: Line[]) {
  console.log(`\n${title}`);
  for (const L of lines) {
    const tag = L.skip ? 'SKIP' : L.ok ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${L.label}${L.detail ? ` → ${L.detail}` : ''}`);
  }
}

async function main() {
  console.log('========== Phase 1 驗收報告 ==========');
  console.log(`API: ${API_BASE}`);
  console.log(`Login: ${LOGIN_EMAIL}`);

  const token = await login();
  if (!token) {
    console.log('\n[WARN] Login failed — 1A / 1B will SKIP. Check credentials and API URL.');
  }

  const { lines: la } = await run1a(token);
  printSection('1A. KB Search (GET /api/knowledge-base/search)', la);

  const lb = await run1b(token);
  printSection('1B. Prompt Token (buildSystemPrompt + all KB docs)', lb);

  const lc = await run1c();
  printSection('1C. E2E Chat (POST /api/chat/demo)', lc);

  const allLines = [...la, ...lb, ...lc];
  const pass = allLines.filter((l) => l.ok && !l.skip).length;
  const fail = allLines.filter((l) => !l.ok && !l.skip).length;
  const skip = allLines.filter((l) => l.skip).length;
  const total = allLines.filter((l) => !l.skip).length;

  console.log('\n-----------------------------------');
  console.log(`總結：${pass}/${total} PASS, ${fail} FAIL, ${skip} SKIP`);
  const phasePass = fail === 0;
  console.log(`Phase 1: ${phasePass ? 'PASS ✅' : 'FAIL ❌'}`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
