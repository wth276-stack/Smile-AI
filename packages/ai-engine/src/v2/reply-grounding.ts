import type { KnowledgeChunk } from '../types';
import { buildServiceCatalog } from '../service-matcher';

/**
 * High-risk cross-industry terms: if the model mentions them, they must appear in the
 * tenant allowlist (SERVICE catalog + chunk titles/aliases) or the reply is corrected.
 * Raw chunk content is not used for allow (avoids false positives e.g. 「不提供按摩」).
 */
const GROUNDED_TERMS: Array<{ term: string; re: RegExp }> = [
  { term: '按摩', re: /按摩/g },
  { term: '推拿', re: /推拿/g },
  { term: '美甲', re: /美甲/g },
  { term: '美睫', re: /美睫/g },
  { term: '紋眉', re: /紋眉/g },
  { term: '脫毛', re: /脫毛/g },
];

const CUSTOMER_SAFE_FALLBACK =
  '多謝你嘅查詢！我哋暫時未有呢方面嘅服務資料，歡迎聯絡我哋了解更多 😊';

const MIN_REMAINING_CHARS = 12;

function catalogAllowsTerm(authorisedServiceCatalog: string[] | undefined, term: string): boolean {
  if (!authorisedServiceCatalog?.length) return false;
  return authorisedServiceCatalog.some((t) => t.includes(term));
}

function chunkTitleOrAliasAllowsTerm(chunks: KnowledgeChunk[], term: string): boolean {
  for (const c of chunks) {
    const pool = [c.title, ...(c.aliases ?? [])].filter(Boolean) as string[];
    if (pool.some((p) => p.includes(term))) return true;
  }
  return false;
}

/**
 * True if the high-risk term is supported by tenant SERVICE names or by a retrieved
 * document title/alias (not body text).
 */
function isHighRiskTermAllowed(
  term: string,
  authorisedServiceCatalog: string[] | undefined,
  chunks: KnowledgeChunk[],
): boolean {
  if (catalogAllowsTerm(authorisedServiceCatalog, term)) return true;
  return chunkTitleOrAliasAllowsTerm(chunks, term);
}

/** Remove sentence-like units that contain the term; best-effort for zh. */
function removeSegmentsContaining(reply: string, term: string): string {
  const split = reply.split(/(?<=[。！？\n；])/);
  const kept = split.filter((s) => s.trim() && !s.includes(term));
  return kept.join('').replace(/\s+/g, ' ').trim();
}

function tryCleanRemove(reply: string, re: RegExp, term: string): string | null {
  re.lastIndex = 0;
  const bySentence = removeSegmentsContaining(reply, term);
  if (bySentence.length >= MIN_REMAINING_CHARS) {
    return bySentence;
  }
  const collapsed = reply
    .replace(re, ' ')
    .replace(/[ \t\u3000]{2,}/g, ' ')
    .replace(/\s+([，。！？])/g, '$1')
    .trim();
  if (collapsed.length >= MIN_REMAINING_CHARS) {
    return collapsed;
  }
  return null;
}

export interface ReplyGroundingOptions {
  authorisedServiceCatalog?: string[];
}

/**
 * Removes or replaces ungrounded high-risk product mentions. Customer-visible text stays
 * natural; issue strings are for logs / validationIssues only.
 */
export function applyReplyGrounding(
  reply: string,
  knowledgeChunks: KnowledgeChunk[],
  options?: ReplyGroundingOptions,
): { reply: string; rewritten: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!reply?.trim()) {
    return { reply, rewritten: false, issues };
  }

  const catalog = options?.authorisedServiceCatalog;
  let out = reply;
  let rewritten = false;

  for (const { term, re } of GROUNDED_TERMS) {
    re.lastIndex = 0;
    if (!re.test(out)) continue;
    if (isHighRiskTermAllowed(term, catalog, knowledgeChunks)) continue;

    issues.push(`Reply grounding: removed unlisted term "${term}" (not in tenant catalog / KB allowlist)`);

    const cleaned = tryCleanRemove(out, re, term);
    if (cleaned !== null) {
      out = cleaned;
    } else {
      out = CUSTOMER_SAFE_FALLBACK;
    }
    rewritten = true;
  }

  return { reply: out.trim(), rewritten, issues };
}

const MAX_NAMES_IN_PROMPT = 48;
const MAX_CATALOG_LINE_CHARS = 900;

/**
 * One compact line for the system prompt: prefer full-tenant catalog when provided;
 * else derive from retrieved chunks.
 */
export function formatAuthorisedServiceLine(
  catalog: string[] | undefined,
  knowledgeChunks: KnowledgeChunk[],
): string {
  const raw =
    catalog && catalog.length > 0
      ? [...new Set(catalog.map((s) => s.trim()).filter(Boolean))]
      : [...new Set(buildServiceCatalog(knowledgeChunks).map((c) => c.displayName))].filter(Boolean);

  if (raw.length === 0) {
    return '（此輪未載入服務項目名稱；回答時以再下方已列內容為準。）';
  }

  let line = raw.slice(0, MAX_NAMES_IN_PROMPT).join('、');
  if (line.length > MAX_CATALOG_LINE_CHARS) {
    line = `${line.slice(0, MAX_CATALOG_LINE_CHARS - 1)}…`;
  }
  return line;
}
