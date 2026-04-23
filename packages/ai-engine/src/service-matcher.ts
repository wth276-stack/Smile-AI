import type { BookingDraft, KnowledgeChunk, ServiceEntry, ServiceMatchResult } from './types';

// ── Full-width → half-width (ASCII range), ideographic space ──

function foldFullWidth(str: string): string {
  return str
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// ── Text normalization ──

export function normalize(text: string): string {
  return foldFullWidth(text)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, '')
    .replace(/([\u4e00-\u9fff])([a-zA-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])([\u4e00-\u9fff])/g, '$1 $2')
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** English token stem: conservative to avoid over-stripping short words. */
function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length < 4) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.length >= 5 && /(sses|ches|shes|xes|zes)$/.test(w)) {
    return w.slice(0, -2);
  }
  if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) {
    return w.slice(0, -1);
  }
  return w;
}

function stemPhrase(text: string): string {
  return normalize(text)
    .split(/\s+/)
    .map(stem)
    .join(' ');
}

const GENERIC_ENGLISH_TOKENS = new Set([
  'treatment',
  'service',
  'facial',
  'massage',
  'therapy',
  'care',
  'session',
  // Cross-domain product-style words (fitness / education / repairs) — too generic to be a primary alias alone
  'class',
  'training',
  'repair',
  'lesson',
]);

// ── Alias generation ──

function addEnglishPluralVariants(name: string, aliases: Set<string>): void {
  const tokens = name.match(/[a-zA-Z]{2,}/g) || [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const raw = tokens[i].toLowerCase();
    if (GENERIC_ENGLISH_TOKENS.has(raw)) continue;
    const n = normalize(raw);
    if (n.length < 2) continue;
    aliases.add(n);
    if (!n.endsWith('s')) aliases.add(normalize(n + 's'));
    if (!n.endsWith('es')) aliases.add(normalize(n + 'es'));
    break;
  }
}

/**
 * Optional low-risk Chinese 3-grams: only when the CJK run is long enough that
 * extra substrings rarely collide across unrelated services.
 */
function addChineseTrigrams(chinese: string, aliases: Set<string>): void {
  if (chinese.length < 5) return;
  const maxTrigrams = 6;
  let count = 0;
  for (let i = 0; i <= chinese.length - 3 && count < maxTrigrams; i++) {
    aliases.add(chinese.substring(i, i + 3));
    count++;
  }
}

function generateAliases(name: string): string[] {
  const aliases = new Set<string>();
  const n = normalize(name);
  aliases.add(n);
  aliases.add(stemPhrase(name));

  const chinese = name.replace(/[^\u4e00-\u9fff]/g, '');
  if (chinese.length >= 2) {
    aliases.add(chinese);
    for (let i = 0; i < chinese.length - 1; i++) {
      aliases.add(chinese.substring(i, i + 2));
    }
    addChineseTrigrams(chinese, aliases);
  }
  // 瑜伽 vs 珈 / 冮 variant — common in user input; treat as the same when matching
  if (chinese.includes('瑜伽')) {
    aliases.add(chinese.replace(/瑜伽/g, '瑜珈'));
  }
  if (chinese.includes('瑜珈')) {
    aliases.add(chinese.replace(/瑜珈/g, '瑜伽'));
  }

  addEnglishPluralVariants(name, aliases);

  return [...aliases].filter((a) => a.length >= 2);
}

// ── Build service catalog from knowledge docs ──

export function buildServiceCatalog(knowledge: KnowledgeChunk[]): ServiceEntry[] {
  const catalog: ServiceEntry[] = [];
  const pricePattern = /[:：]\s*(HKD|\$|hkd)\s*\d+/i;

  for (const doc of knowledge) {
    const lines = doc.content.split('\n').filter((l) => l.trim());
    const serviceLines = lines.filter((l) => pricePattern.test(l));

    if (serviceLines.length > 1 && isServiceListDocument(lines)) {
      for (const line of serviceLines) {
        const nameMatch = line.match(/^(.+?)[:：]\s*(HKD|\$)/i);
        if (!nameMatch) continue;

        const displayName = nameMatch[1].trim();
        const code = normalize(displayName).replace(/\s+/g, '_');

        catalog.push({
          code,
          displayName,
          aliases: generateAliases(displayName),
          priceInfo: line.trim(),
          fullInfo: line.trim(),
          // Structured fields not available in service list documents
        });
      }
    } else {
      const displayName = doc.title;
      const code = normalize(displayName).replace(/\s+/g, '_');

      // Merge auto-generated aliases with user-defined aliases from KB
      const autoAliases = generateAliases(displayName);
      const userAliases = (doc.aliases || []).map(a => normalize(a));
      const allAliases = [...new Set([...autoAliases, ...userAliases])];

      const contentServiceName = extractServiceNameFromContent(lines);
      if (contentServiceName && contentServiceName !== displayName) {
        allAliases.push(...generateAliases(contentServiceName));
      }

      const priceLines = lines.filter((l) =>
        /價|price|hkd|\$|收費|cost|優惠|折|試做|正價|零售/i.test(l),
      );

      catalog.push({
        code,
        displayName,
        aliases: [...new Set(allAliases)],
        priceInfo: priceLines.length > 0 ? priceLines.join('\n') : null,
        fullInfo: doc.content,
        // Structured fields (Phase 1.5C)
        effect: doc.effect,
        suitable: doc.suitable,
        unsuitable: doc.unsuitable,
        precaution: doc.precaution,
        duration: doc.duration,
        // Pricing fields (Phase 1.5D)
        price: doc.price,
        discountPrice: doc.discountPrice,
        // Steps field (Phase 1.5D)
        steps: doc.steps,
        // FAQ items (Phase 1.5D)
        faqItems: doc.faqItems,
      });
    }
  }

  return catalog;
}

function isServiceListDocument(lines: string[]): boolean {
  const pricePattern = /[:：]\s*(HKD|\$|hkd)\s*\d+/i;
  const priceLabelPattern = /^(正價|試做價|零售價|原價|優惠價|售價|定價|特價|會員價|price|cost|retail|sale)/i;
  const priceLines = lines.filter((l) => pricePattern.test(l));
  if (priceLines.length < 2) return false;
  const labelCount = priceLines.filter((l) => priceLabelPattern.test(l.trim())).length;
  if (labelCount >= priceLines.length * 0.5) return false;
  return true;
}

function extractServiceNameFromContent(lines: string[]): string | null {
  if (lines.length === 0) return null;
  const firstLine = lines[0].trim();
  if (firstLine.length >= 2 && firstLine.length <= 40 && !/[:：]/.test(firstLine)) {
    return firstLine;
  }
  const nameMatch = firstLine.match(/^(?:產品名稱|服務名稱|項目名稱|名稱)[:：]\s*(.+)/);
  if (nameMatch) return nameMatch[1].trim();
  return null;
}

// ── Match user input against service catalog ──

export function matchService(input: string, catalog: ServiceEntry[]): ServiceMatchResult {
  if (catalog.length === 0) return { type: 'none', matches: [] };

  const normalizedInput = normalize(input);
  if (!normalizedInput || normalizedInput.length < 2) return { type: 'none', matches: [] };

  const result = scoreServices(normalizedInput, catalog);
  if (result.type !== 'none') return result;

  const genericWords = new Set([
    'treatment',
    'service',
    'facial',
    'massage',
    'therapy',
    '療程',
    '服務',
    '護理',
    ...GENERIC_ENGLISH_TOKENS,
  ]);
  const words = stemPhrase(input)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !genericWords.has(w));
  for (const word of words) {
    const retry = scoreServices(word, catalog);
    if (retry.type === 'exact' || retry.type === 'close') return retry;
  }

  return result;
}

function isAmbiguousPair(
  top: { confidence: number },
  second: { confidence: number } | undefined,
  zone: 'high' | 'mid',
): boolean {
  if (!second) return false;
  const gap = top.confidence - second.confidence;
  if (zone === 'high') {
    if (second.confidence >= 0.75) return true;
    if (second.confidence >= 0.62 && gap < 0.09) return true;
    return false;
  }
  if (second.confidence >= 0.45) return true;
  if (second.confidence >= 0.38 && gap < 0.08) return true;
  return false;
}

function scoreServices(input: string, catalog: ServiceEntry[]): ServiceMatchResult {
  const normalizedInput = normalize(input);
  const stemmedInput = stemPhrase(input);

  const scored: { service: ServiceEntry; confidence: number }[] = [];

  for (const service of catalog) {
    let best = 0;

    for (const alias of service.aliases) {
      const na = normalize(alias);
      const sa = stemPhrase(alias);

      if (normalizedInput === na || stemmedInput === sa) {
        best = Math.max(best, 1.0);
      } else if (normalizedInput.includes(na) && na.length >= 3) {
        best = Math.max(best, 0.95);
      } else if (stemmedInput.includes(sa) && sa.length >= 3) {
        best = Math.max(best, 0.9);
      } else if (na.includes(normalizedInput) && normalizedInput.length >= 3) {
        best = Math.max(best, 0.7);
      } else if (sa.includes(stemmedInput) && stemmedInput.length >= 3) {
        best = Math.max(best, 0.65);
      } else {
        const inputWords = new Set(stemmedInput.split(/\s+/).filter((w) => w.length >= 2));
        const aliasWords = sa.split(/\s+/).filter((w) => w.length >= 2);
        if (aliasWords.length > 0) {
          const overlap = aliasWords.filter((w) => inputWords.has(w)).length;
          if (overlap > 0) {
            const score = (overlap / Math.max(aliasWords.length, inputWords.size)) * 0.8;
            best = Math.max(best, score);
          }
        }
      }
    }

    if (best > 0.15) {
      scored.push({ service, confidence: best });
    }
  }

  scored.sort((a, b) => b.confidence - a.confidence);

  if (scored.length === 0) return { type: 'none', matches: [] };

  const top = scored[0];
  const second = scored[1];

  if (top.confidence >= 0.8) {
    if (isAmbiguousPair(top, second, 'high')) {
      return { type: 'ambiguous', matches: scored.slice(0, 3) };
    }
    return { type: 'exact', matches: [top] };
  }

  if (top.confidence >= 0.5) {
    if (isAmbiguousPair(top, second, 'mid')) {
      return { type: 'ambiguous', matches: scored.slice(0, 3) };
    }
    return { type: 'close', matches: [top] };
  }

  return { type: 'none', matches: scored.slice(0, 3) };
}

// ── Extract service-related text from a message ──

export function extractServiceText(msg: string): string {
  return msg
    // Standalone greetings only: \b prevents stripping "Hi" from "HIFU", "High", etc.
    .replace(/^(hi|hello|hey)\b[,，。！!\s]*/gi, '')
    .replace(/^(你好|嗨|哈囉)(?:[,，。！!\s]+|$)/u, '')
    .replace(
      /^(其實|順便問下|想請教|麻煩|唔該|唔該晒|請問下|請問一下|想問下|想問|請問)\s*/g,
      '',
    )
    .replace(/^(我想要|我想做|我想試|我想約|我想了解|我想|想要|想做|想試|想約|想了解|想|我要|要|幫我|可以|請問)\s*/g, '')
    .replace(/\s*(幾錢|多少錢|價錢|收費|price|how much|cost).*$/gi, '')
    .replace(/(預約|book|約|訂)\s*/g, '')
    .replace(/(好呀|好的|ok|sure)\s*/gi, '')
    .replace(/(了解|知道|了解下|知道下)\s*/g, '')
    .trim();
}

// ── Service taxonomy: domain-agnostic category detection ──
//
// Category terms are stable shared tokens — not arbitrary CJK n-grams.
// Sources: full display names, full CJK portions, English stems ≥3 chars,
// and explicit KB aliases. Arbitrary CJK bigrams/trigrams are excluded
// because they create noisy false categories (e.g. "清潔" matching across
// unrelated services).

export interface ServiceTaxonomy {
  /** Category term → services sharing that term (2+ services) */
  categories: Map<string, ServiceEntry[]>;
  /** Service code → category terms the service belongs to */
  serviceCategories: Map<string, Set<string>>;
}

export interface ServiceSwitchResult {
  type: 'clear' | 'replace';
  serviceName?: string;
  serviceDisplayName?: string;
}

/**
 * Extract stable category candidates from a service entry.
 * Only uses whole-name tokens and explicit labels — never arbitrary CJK fragments.
 */
function extractStableCategoryCandidates(service: ServiceEntry): string[] {
  const candidates = new Set<string>();
  const name = service.displayName;

  // Full normalized + stemmed display name (whole string, not fragments)
  candidates.add(normalize(name));
  candidates.add(stemPhrase(name));

  // Full CJK portion of the display name (e.g. CJK run from "BrandName 產品全名")
  const cjk = name.replace(/[^\u4e00-\u9fff]/g, '');
  if (cjk.length >= 2) candidates.add(cjk);

  // English stems ≥3 chars (e.g. product or modality tokens from the title)
  for (const w of (name.match(/[a-zA-Z]{3,}/g) || [])) {
    candidates.add(stem(w.toLowerCase()));
  }

  // Explicit KB aliases (user-defined labels, not auto-generated fragments)
  for (const alias of service.aliases) {
    const na = normalize(alias);
    // Only keep aliases that are whole terms (≥2 chars, not 2-char CJK fragments)
    if (na.length >= 3 || (na.length === 2 && /[a-zA-Z]/.test(na))) {
      // Skip 2-char CJK-only strings (these are auto-generated bigrams)
      if (/^[\u4e00-\u9fff]{2}$/.test(na)) continue;
      // Skip 3-char CJK-only strings (auto-generated trigrams)
      if (/^[\u4e00-\u9fff]{3}$/.test(na)) continue;
      candidates.add(na);
    }
    // English stems from aliases
    for (const w of (alias.match(/[a-zA-Z]{3,}/g) || [])) {
      candidates.add(stem(w.toLowerCase()));
    }
  }

  return [...candidates].filter(c => c.length >= 2);
}

/**
 * Build a taxonomy from the service catalog by finding stable shared tokens
 * across 2+ services. Category terms come from:
 * - Full display names (normalized + stemmed)
 * - Full CJK portions of display names
 * - English word stems ≥3 chars
 * - Explicit KB aliases (filtered to remove auto-generated CJK fragments)
 *
 * Domain-agnostic: beauty → "facial", dental → "implant", gym → "yoga".
 * CJK category terms require explicit KB aliases (e.g. aliases: ["美白療程"]).
 */
export function buildServiceTaxonomy(catalog: ServiceEntry[]): ServiceTaxonomy {
  const termToServices = new Map<string, Set<string>>();

  for (const service of catalog) {
    const candidates = extractStableCategoryCandidates(service);
    for (const term of candidates) {
      const set = termToServices.get(term) ?? new Set();
      set.add(service.code);
      termToServices.set(term, set);
    }
  }

  // Categories: stable terms appearing in 2+ services
  const categories = new Map<string, ServiceEntry[]>();
  const serviceCategories = new Map<string, Set<string>>();

  for (const [term, serviceCodes] of termToServices) {
    if (serviceCodes.size >= 2) {
      const catServices = catalog.filter(s => serviceCodes.has(s.code));
      categories.set(term, catServices);
      for (const code of serviceCodes) {
        const set = serviceCategories.get(code) ?? new Set();
        set.add(term);
        serviceCategories.set(code, set);
      }
    }
  }

  return { categories, serviceCategories };
}

/**
 * Detect when a user switches services during an active booking.
 * Conservative: returns null if unsure. Only clears/replaces when confident.
 *
 * Uses the post-merge service (newSlots.serviceName || draft.serviceName) as
 * the baseline, so it works correctly whether or not the LLM extracted a service.
 *
 * - exact concrete item mention → replace
 * - exact generic category mention → clear (even if LLM already picked one)
 * - no reliable switch → null
 */
export function detectServiceSwitch(
  message: string,
  draft: BookingDraft,
  newSlots: Partial<BookingDraft>,
  catalog: ServiceEntry[],
  taxonomy: ServiceTaxonomy,
): ServiceSwitchResult | null {
  // No draft service → no switch possible
  if (!draft.serviceName) return null;

  // Post-merge baseline: newSlots takes precedence over draft.
  // This handles the case where LLM already extracted a new service.
  const currentService = newSlots.serviceName || draft.serviceName;
  const currentDisplayService = newSlots.serviceDisplayName || draft.serviceDisplayName;

  const extracted = extractServiceText(message);
  if (!extracted || extracted.length < 2) return null;

  const matchResult = matchService(extracted, catalog);

  // No match → null (no service mentioned)
  if (matchResult.type === 'none') return null;

  // Ambiguous match → category-level reference if all matches
  // differ from the current (post-merge) service.
  if (matchResult.type === 'ambiguous') {
    const allDifferentFromCurrent = matchResult.matches.every(
      m => m.service.code !== currentService
        && m.service.displayName !== currentDisplayService,
    );
    if (allDifferentFromCurrent) return { type: 'clear' };

    // User text is only a shared category token (e.g. "FACIAL") but post-merge
    // draft/LLM already points at one family member — still disambiguate, not
    // treat as a committed choice.
    const stemIn = stemPhrase(extracted);
    const normIn = normalize(extracted);
    for (const hit of matchResult.matches) {
      const cats = taxonomy.serviceCategories.get(hit.service.code);
      if (!cats) continue;
      for (const cat of cats) {
        if (stemIn === stemPhrase(cat) || normIn === normalize(cat)) {
          return { type: 'clear' };
        }
      }
    }
    return null;
  }

  // Exact/close match — safe to access matchedService
  const matchedService = matchResult.matches[0].service;

  // Check if user's input is a category-level reference even when matched
  // service is the same as current. E.g. user types "FACIAL" → matchService
  // returns exact for "深層清潔 Facial", but "facial" is a category term —
  // user should be asked which subtype, not locked into the LLM's pick.
  const cats = taxonomy.serviceCategories.get(matchedService.code);
  const stemmedInput = stemPhrase(extracted);
  const normalizedInput = normalize(extracted);

  if (cats && cats.size > 0) {
    for (const cat of cats) {
      if (stemmedInput === stemPhrase(cat) || normalizedInput === normalize(cat)) {
        return { type: 'clear' };
      }
    }
  }

  // Same as the post-merge service and input is not a category reference → no switch
  if (matchedService.code === currentService
    || matchedService.displayName === currentDisplayService) {
    return null;
  }

  // Different service, not a category reference
  // No category terms → unique service, safe to replace
  if (!cats || cats.size === 0) {
    return { type: 'replace', serviceName: matchedService.code, serviceDisplayName: matchedService.displayName };
  }

  // Service is in a generic family but input is more specific than a category → replace
  return { type: 'replace', serviceName: matchedService.code, serviceDisplayName: matchedService.displayName };
}

// ── Regression (after build: from repo root)
// node -e "const m=require('./packages/ai-engine/dist/service-matcher.js');const r=m.verifyServiceMatcherRegression();console.log(JSON.stringify(r,null,2));process.exit(r.ok?0:1);"
// ──

export function verifyServiceMatcherRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const knowledgeBaseline: KnowledgeChunk[] = [
    {
      documentId: 'reg-eye',
      title: 'Eye Treatment',
      content: 'Eye Treatment\n功效：緊緻\n正價: HKD 350',
      score: 1,
    },
    {
      documentId: 'reg-facial',
      title: 'Facial Treatment',
      content: 'Facial Treatment\nDeep info\nHKD 480',
      score: 1,
    },
    {
      documentId: 'reg-white',
      title: '美白產品',
      content: '美白產品\n零售: HKD 100',
      score: 1,
    },
    {
      documentId: 'reg-focus',
      title: 'Focus HIFU Treatment',
      content: 'Focus HiFu line\n正價：$6980\n試做價：$4980',
      score: 1,
    },
    {
      documentId: 'reg-hydrate',
      title: 'Hydrating Facial',
      content: 'Hydrating Facial\nHKD 580',
      score: 1,
    },
  ];

  const knowledgeEdge: KnowledgeChunk[] = [
    ...knowledgeBaseline,
    {
      documentId: 'reg-laser-spot',
      title: '激光祛斑',
      content: '激光祛斑\n正價: HKD 1200',
      score: 1,
    },
    {
      documentId: 'reg-laser-glow',
      title: '激光嫩膚',
      content: '激光嫩膚\n正價: HKD 1500',
      score: 1,
    },
    {
      documentId: 'reg-whiten-a',
      title: '皇室美白療程',
      content: '皇室美白療程\n試做: HKD 880',
      score: 1,
    },
    {
      documentId: 'reg-whiten-b',
      title: '晶鑽美白療程',
      content: '晶鑽美白療程\n試做: HKD 980',
      score: 1,
    },
    {
      documentId: 'reg-anti-a',
      title: 'Anti-aging Treatment',
      content: 'Anti-aging Treatment\nHKD 900',
      score: 1,
    },
    {
      documentId: 'reg-anti-b',
      title: 'Anti-aging Facial',
      content: 'Anti-aging Facial\nHKD 850',
      score: 1,
    },
  ];

  const catalogBaseline = buildServiceCatalog(knowledgeBaseline);
  const catalogEdge = buildServiceCatalog(knowledgeEdge);

  function fail(
    label: string,
    query: string,
    r: ServiceMatchResult,
    detail?: string,
  ): void {
    failures.push(
      `${label}: query=${JSON.stringify(query)} type=${r.type} matches=${r.matches.map((m) => `${m.service.displayName}(${m.confidence.toFixed(2)})`).join(',')}${detail ? ` | ${detail}` : ''}`,
    );
  }

  function expectMatchOn(
    cat: ServiceEntry[],
    label: string,
    query: string,
    predicate: (r: ServiceMatchResult) => boolean,
  ): void {
    const r = matchService(query, cat);
    if (!predicate(r)) {
      fail(label, query, r);
    }
  }

  function expectAmbiguousOn(
    cat: ServiceEntry[],
    label: string,
    query: string,
    displayNamesMustAppear: string[],
  ): void {
    const r = matchService(query, cat);
    if (r.type !== 'ambiguous') {
      fail(label, query, r, `expected ambiguous`);
      return;
    }
    const got = new Set(r.matches.map((m) => m.service.displayName));
    for (const name of displayNamesMustAppear) {
      if (!got.has(name)) {
        fail(label, query, r, `missing match ${name}`);
      }
    }
  }

  function expectNoneOn(cat: ServiceEntry[], label: string, query: string): void {
    const r = matchService(query, cat);
    if (r.type !== 'none') {
      fail(label, query, r, `expected none`);
    }
  }

  // ── Baseline catalog (stable ranking; avoids generic-token ties in huge catalogs) ──
  expectMatchOn(catalogBaseline, 'eyes treatment', 'eyes treatment', (r) => r.matches[0]?.service.displayName === 'Eye Treatment');
  expectMatchOn(catalogBaseline, 'eye treatment', 'eye treatment', (r) => r.matches[0]?.service.displayName === 'Eye Treatment');

  expectMatchOn(catalogBaseline, 'fullwidth focus', 'Ｆｏｃｕｓ ＨＩＦＵ', (r) => r.matches[0]?.service.displayName === 'Focus HIFU Treatment');

  expectMatchOn(catalogBaseline, '美白treatment', '美白treatment', (r) => r.matches[0]?.service.displayName === '美白產品');

  expectMatchOn(catalogBaseline, 'hydrating facials', 'hydrating facials', (r) => r.matches[0]?.service.displayName === 'Hydrating Facial');

  const stripped = extractServiceText('請問下我想了解Eye Treatment');
  expectMatchOn(catalogBaseline, 'extract+match', stripped, (r) => r.matches[0]?.service.displayName === 'Eye Treatment');

  expectNoneOn(catalogBaseline, 'unrelated 咖啡機', '我要買咖啡機');

  // Full-width Latin + ideographic space inside CJK (fold + CJK space collapse)
  expectMatchOn(
    catalogBaseline,
    'fullwidth mixed 美白+treatment',
    '美\u3000白ｔｒｅａｔｍｅｎｔ',
    (r) => r.matches[0]?.service.displayName === '美白產品',
  );

  // ── Extended catalog: Chinese similar names → ambiguous ──
  expectAmbiguousOn(catalogEdge, 'collision 激光', '激光', ['激光祛斑', '激光嫩膚']);
  expectAmbiguousOn(catalogEdge, 'collision 美白療程 substring', '美白療程', ['皇室美白療程', '晶鑽美白療程']);

  // ── Extended: English near-duplicate family → ambiguous ──
  expectAmbiguousOn(catalogEdge, 'collision anti-aging', 'anti aging', ['Anti-aging Treatment', 'Anti-aging Facial']);

  // Disambiguate Chinese whitening siblings (not ambiguous when full name given)
  expectMatchOn(catalogEdge, 'exact 激光祛斑', '激光祛斑', (r) => r.matches[0]?.service.displayName === '激光祛斑');
  expectMatchOn(catalogEdge, 'exact 晶鑽美白療程', '晶鑽美白療程', (r) => r.matches[0]?.service.displayName === '晶鑽美白療程');
  expectMatchOn(catalogEdge, 'exact 皇室美白療程', '皇室美白療程', (r) => r.matches[0]?.service.displayName === '皇室美白療程');

  // ── Extended: full-width + mixed Latin tokens ──
  expectMatchOn(
    catalogEdge,
    'fullwidth eye+treatment',
    'ｅｙｅ　ｔｒｅａｔｍｅｎｔ',
    (r) => r.matches[0]?.service.displayName === 'Eye Treatment',
  );
  expectMatchOn(
    catalogEdge,
    'mixed CJK+Latin focus',
    '我想做ＦｏｃｕｓＨＩＦＵ',
    (r) => r.matches[0]?.service.displayName === 'Focus HIFU Treatment',
  );

  // ── Extended: plural / singular ──
  expectMatchOn(catalogEdge, 'eye treatments plural', 'eye treatments', (r) => r.matches[0]?.service.displayName === 'Eye Treatment');
  expectMatchOn(catalogEdge, 'facial treatment singular', 'facial treatment', (r) => r.matches[0]?.service.displayName === 'Facial Treatment');
  expectMatchOn(catalogEdge, 'hydrating facial singular', 'hydrating facial', (r) => r.matches[0]?.service.displayName === 'Hydrating Facial');

  // ── Extended: unrelated → none ──
  expectNoneOn(catalogEdge, 'unrelated weather', '今日天氣點樣');
  expectNoneOn(catalogEdge, 'unrelated dinner', '今晚食乜好');
  expectNoneOn(catalogEdge, 'unrelated random ascii', 'asdfghjkl qwerty');
  expectNoneOn(catalogEdge, 'unrelated emoji noise', '😀🎉預約打折');
  expectNoneOn(catalogEdge, 'unrelated long nonsense zh', '宇宙無敵超級無關問題查詢');

  const noiseStripped = extractServiceText('請問下預約打折優惠');
  expectMatchOn(catalogEdge, 'extract noise then none', noiseStripped, (r) => r.type === 'none');

  // Greeting strip must not eat "Hi" inside HIFU / High…
  const hifuEx = extractServiceText('HIFU 幾錢？').replace(/\s+/g, '');
  if (!/^hifu$/i.test(hifuEx)) {
    failures.push(`extract HIFU: got "${hifuEx}", want HIFU`);
  }
  if (!/eye\s*treatment/i.test(extractServiceText('Hi, Eye Treatment 幾錢'))) {
    failures.push('extract Hi,: Eye Treatment damaged');
  }
  if (!/^high\s+intensity\s+facial/i.test(extractServiceText('High intensity facial 幾錢').trim())) {
    failures.push('extract High intensity facial damaged');
  }

  return { ok: failures.length === 0, failures };
}
