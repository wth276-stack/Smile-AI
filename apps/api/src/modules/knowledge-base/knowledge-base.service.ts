import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { KnowledgeDocument } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseDocument, extractTitle } from '@ats/ai-engine';

export interface KbSearchDebug {
  originalQuery: string;
  finalFallback: 'none' | 'synonym_pass' | 'low_score_pass' | 'tenant_doc_fallback';
  steps: Array<{
    name: 'primary' | 'synonym' | 'low_score' | 'tenant_fallback';
    keywords: string[];
    minDocScore: number;
    resultCount: number;
    topScores: Array<{ id: string; title: string; score: number }>;
  }>;
}

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.knowledgeDocument.findMany({
      where: { tenantId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(tenantId: string, data: {
    title: string;
    content: string;
    category?: string;
    tags?: string[];
    aliases?: string[];
    docType?: 'SERVICE' | 'FAQ' | 'GENERAL';
    effect?: string;
    suitable?: string;
    unsuitable?: string;
    precaution?: string;
    duration?: string;
    price?: string;
    discountPrice?: string;
    steps?: string[];
    faqItems?: Array<{ question: string; answer: string }>;
  }) {
    return this.prisma.knowledgeDocument.create({
      data: {
        ...data,
        tenantId,
        docType: data.docType || 'GENERAL',
      },
    });
  }

  async update(tenantId: string, id: string, data: {
    title?: string;
    content?: string;
    category?: string;
    tags?: string[];
    aliases?: string[];
    isActive?: boolean;
    docType?: 'SERVICE' | 'FAQ' | 'GENERAL';
    effect?: string;
    suitable?: string;
    unsuitable?: string;
    precaution?: string;
    duration?: string;
    price?: string;
    discountPrice?: string;
    steps?: string[];
    faqItems?: Array<{ question: string; answer: string }>;
  }) {
    return this.prisma.knowledgeDocument.update({
      where: { id },
      data,
    });
  }

  async softDelete(tenantId: string, id: string) {
    await this.prisma.knowledgeDocument.findFirstOrThrow({ where: { id, tenantId } });
    return this.prisma.knowledgeDocument.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /** Max docs returned per search — keeps prompts bounded after ranking. */
  private static readonly KB_SEARCH_MAX_RESULTS = 20;
  private static readonly KB_FALLBACK_TAKE = 10;
  /** Drop weak lexical hits unless we are in the low-score fallback pass. */
  private static readonly KB_MIN_SCORE_PRIMARY = 8;

  /**
   * Rank hits: title match > aliases > content (per keyword, best tier only).
   */
  private scoreKnowledgeHit(
    doc: { title: string; content: string; aliases: string[] | null },
    keywords: string[],
  ): number {
    let score = 0;
    const titleLower = doc.title.toLowerCase();
    const contentLower = doc.content.toLowerCase();
    const aliases = doc.aliases ?? [];

    for (const raw of keywords) {
      const k = raw.trim();
      if (!k) continue;
      const kLower = k.toLowerCase();

      if (titleLower.includes(kLower) || doc.title.includes(k)) {
        score += 100;
        continue;
      }

      const aliasHit = aliases.some((a) => {
        const al = a.toLowerCase();
        return al === kLower || al.includes(kLower) || kLower.includes(al);
      });
      if (aliasHit) {
        score += 60;
        continue;
      }

      if (contentLower.includes(kLower) || doc.content.includes(k)) {
        score += 10;
      }
    }

    return score;
  }

  private buildOrConditions(keywords: string[]) {
    return keywords.flatMap((kw) => [
      { title: { contains: kw, mode: 'insensitive' as const } },
      { content: { contains: kw, mode: 'insensitive' as const } },
      { aliases: { has: kw } },
    ]);
  }

  private mergeKeywords(query: string, broad: boolean): string[] {
    const base = this.extractKeywords(query);
    const k = this.injectRetrievalSynonyms(query, base, broad);
    const ensured = this.ensureNonEmptyKeywordSet(query, k);
    return [...new Set(ensured.filter(Boolean))];
  }

  private ensureNonEmptyKeywordSet(message: string, kws: string[]): string[] {
    if (kws.length > 0) return kws;
    const cjk = message.replace(/[^\u4e00-\u9fff]/g, '');
    if (cjk.length >= 2) {
      return [cjk, ...[...Array(cjk.length - 1)].map((_, i) => cjk.substring(i, i + 2))];
    }
    if (cjk.length === 1) return [cjk];
    return ['服務', '常見', '價', '體驗'];
  }

  /**
   * Extra retrieval tokens for short Cantonese: 試堂 vs 體驗, 有冇, 幾多錢, 瑜/伽 variants.
   */
  private injectRetrievalSynonyms(
    message: string,
    base: string[],
    broad: boolean,
  ): string[] {
    const out: string[] = [...base];
    const add = (xs: string[]) => {
      for (const x of xs) out.push(x);
    };
    if (/試堂|體驗|首堂|體驗堂|有冇.*堂|有無.*堂|想.*堂|想.*試|首堂|半價/.test(message)) {
      add([
        '體驗',
        '體驗價',
        '首堂',
        '體驗堂',
        '半價',
        '正價',
        '優惠',
        '試用',
        '體驗',
      ]);
    }
    if (/有冇|有無|有没|有吗/.test(message)) {
      add(['服務', '價', '收費', '堂']);
    }
    if (/幾多錢|幾錢|幾元|幾多|幾$|收費|價格|價錢|多少錢|點收/.test(message)) {
      add(['價', '收費', '錢', 'HKD', 'HK$', '正價', '體驗價', '半價', '優惠', '零售']);
    }
    if (/瑜伽|瑜珈|yoga|private-yoga|私人瑜伽|私人瑜珈/i.test(message) || broad) {
      add(['瑜伽', '瑜珈', 'private-yoga', 'yoga', '私人', '體驗', '月費', '年費', '體驗價', '正價']);
    }
    if (broad) {
      add(['常見', '問', 'FAQ', '服務', '體驗', '正價', '套餐']);
    }
    return out;
  }

  private sortDocHits(
    a: { doc: { updatedAt: Date }; score: number },
    b: { doc: { updatedAt: Date }; score: number },
  ) {
    if (b.score !== a.score) return b.score - a.score;
    return b.doc.updatedAt.getTime() - a.doc.updatedAt.getTime();
  }

  private async findAndScore(
    tenantId: string,
    keywords: string[],
  ): Promise<Array<{ doc: KnowledgeDocument; score: number }>> {
    if (keywords.length === 0) {
      return [];
    }
    const conditions = this.buildOrConditions(keywords);
    const hits = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId, isActive: true, OR: conditions },
    });
    return hits.map((doc) => ({ doc, score: this.scoreKnowledgeHit(doc, keywords) }));
  }

  private async tenantDocFallback(
    tenantId: string,
  ): Promise<Array<{ doc: KnowledgeDocument; score: number }>> {
    const recent = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId, isActive: true },
      take: 40,
      orderBy: { updatedAt: 'desc' },
    });
    const w = (d: (typeof recent)[0]) => (d.docType === 'SERVICE' ? 0 : d.docType === 'FAQ' ? 1 : 2);
    recent.sort((a, b) => {
      const c = w(a) - w(b);
      if (c !== 0) return c;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    return recent.slice(0, KnowledgeBaseService.KB_FALLBACK_TAKE).map((doc) => ({ doc, score: 0.01 }));
  }

  private pushDebugStep(
    steps: KbSearchDebug['steps'],
    name: KbSearchDebug['steps'][0]['name'],
    keywords: string[],
    minDocScore: number,
    scored: Array<{
      doc: { id: string; title: string; updatedAt: Date };
      score: number;
    }>,
  ) {
    const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 8);
    steps.push({
      name,
      keywords: [...keywords],
      minDocScore,
      resultCount: scored.length,
      topScores: top.map((s) => ({ id: s.doc.id, title: s.doc.title, score: s.score })),
    });
  }

  /**
   * Lexical search with short-query synonym expansion, score flooring, and tenant-wide fallback
   * when the query would otherwise return 0 rows (common for Cantonese: 有冇試堂).
   */
  async searchWithDebug(
    tenantId: string,
    query: string,
  ): Promise<{
    docs: KnowledgeDocument[];
    scoresByDocId: Record<string, number>;
    debug: KbSearchDebug;
  }> {
    const originalQuery = query;
    const steps: KbSearchDebug['steps'] = [];
    let finalFallback: KbSearchDebug['finalFallback'] = 'none';

    const runPass = async (
      kws: string[],
      name: KbSearchDebug['steps'][0]['name'],
      minDocScore: number,
    ) => {
      const raw = await this.findAndScore(tenantId, kws);
      const passed = minDocScore > 0 ? raw.filter((r) => r.score >= minDocScore) : raw;
      this.pushDebugStep(steps, name, kws, minDocScore, passed);
      return { raw, passed };
    };

    const k1 = this.mergeKeywords(query, false);
    const p1 = await runPass(k1, 'primary', KnowledgeBaseService.KB_MIN_SCORE_PRIMARY);
    let chosen = p1.passed;
    if (p1.raw.length > 0 && p1.passed.length === 0) {
      finalFallback = 'low_score_pass';
      const p1b = await runPass(k1, 'low_score', 0);
      chosen = p1b.passed;
    }
    if (chosen.length === 0) {
      const k2 = this.mergeKeywords(query, true);
      finalFallback = 'synonym_pass';
      const p2 = await runPass(k2, 'synonym', 0);
      chosen = p2.passed;
    }
    if (chosen.length === 0) {
      finalFallback = 'tenant_doc_fallback';
      const fb = await this.tenantDocFallback(tenantId);
      this.pushDebugStep(steps, 'tenant_fallback', [], 0, fb);
      chosen = fb;
    }

    chosen.sort((a, b) => this.sortDocHits(a, b));
    const top = chosen.slice(0, KnowledgeBaseService.KB_SEARCH_MAX_RESULTS);
    const scoresByDocId: Record<string, number> = {};
    for (const r of top) {
      scoresByDocId[r.doc.id] = r.score;
    }

    const debug: KbSearchDebug = { originalQuery, finalFallback, steps };
    this.logger.log(
      `[kb-search] tenant=${tenantId} q=${JSON.stringify(originalQuery)} fallback=${finalFallback} ` +
        `top=${JSON.stringify(top.slice(0, 5).map((t) => ({ id: t.doc.id, title: t.doc.title, score: t.score })))}`,
    );
    return { docs: top.map((t) => t.doc), scoresByDocId, debug };
  }

  async search(tenantId: string, query: string): Promise<any[]> {
    return (await this.searchWithDebug(tenantId, query)).docs;
  }

  /**
   * Distinct titles of active SERVICE documents — full-tenant list for prompt allowlist
   * and grounding (not dependent on this turn’s retrieval).
   */
  async listActiveServiceDisplayNames(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId, isActive: true, docType: 'SERVICE' },
      select: { title: true },
      orderBy: { title: 'asc' },
    });
    const titles = rows.map((r) => r.title.trim()).filter(Boolean);
    return [...new Set(titles)];
  }

  private extractKeywords(message: string): string[] {
    const enStopWords = new Set([
      'i', 'a', 'an', 'the', 'to', 'is', 'am', 'are', 'was', 'be',
      'want', 'do', 'can', 'please', 'would', 'like', 'need',
      'hi', 'hello', 'hey', 'what', 'how', 'about', 'some', 'any',
      'it', 'my', 'me', 'you', 'your', 'we', 'they', 'this', 'that',
    ]);

    const zhStopPattern = /^(我|你|的|了|是|在|有|和|就|不|也|都|要|會|可以|可|這|那|到|說|想|想要|嗎|呢|吧|啊|喔|哦|嘛|啦|請問|請|幫|幫我|我想|我要|買|想買)$/;
    const enToZhMap: Record<string, string[]> = {
      service: ['服務'],
      services: ['服務'],
      pricing: ['收費', '價錢', '價格'],
      price: ['價錢', '價格', '收費'],
      prices: ['價錢', '價格', '收費'],
      plan: ['方案', '計劃'],
      plans: ['方案', '計劃'],
      faq: ['常見問題', 'FAQ'],
      support: ['支援', '客服'],
      booking: ['預約'],
      trial: ['試用'],
    };

    const keywords: string[] = [];

    const englishWords = message.match(/[a-zA-Z]{2,}/g) || [];
    for (const w of englishWords) {
      const lower = w.toLowerCase();
      if (!enStopWords.has(lower)) {
        keywords.push(w);
        const mapped = enToZhMap[lower];
        if (mapped) keywords.push(...mapped);
      }
    }

    const chineseChars = message.replace(/[^\u4e00-\u9fff]/g, '');
    const stripped = chineseChars.replace(/[我你的了是在有和就不也都要會可以可這那到說想買請問請幫嗎呢吧啊喔哦嘛啦]/g, '');

    // Retrieval hints: align query with KB phrasing (minimal keyword injection).
    if (/維持|幾耐|多久|持續|效果/.test(message)) {
      keywords.push('維持', '個月');
    }
    if (/包含|包咩|有咩內容|套餐/.test(message)) {
      keywords.push('包含', '套餐');
    }

    if (stripped.length >= 2) {
      keywords.push(stripped);
      for (let i = 0; i < stripped.length - 1; i++) {
        keywords.push(stripped.substring(i, i + 2));
      }
    } else if (chineseChars.length >= 2) {
      for (let i = 0; i < chineseChars.length - 1; i++) {
        const bigram = chineseChars.substring(i, i + 2);
        if (!zhStopPattern.test(bigram)) {
          keywords.push(bigram);
        }
      }
    }

    return [...new Set(keywords)];
  }

  /**
   * Upload a file and parse it into a Knowledge Document
   * P0-2A: Raw content storage only (no field extraction yet)
   */
  async uploadAndParse(
    tenantId: string,
    file: Express.Multer.File,
  ): Promise<{
    id: string;
    title: string;
    content: string;
    docType: string;
    wordCount: number;
    charCount: number;
  }> {
    // Parse the document
    const result = await parseDocument(file.buffer, file.mimetype, file.originalname);

    if (!result.success) {
      throw new BadRequestException(result.error || 'Failed to parse document');
    }

    // Extract title from filename
    const title = extractTitle(file.originalname);

    // Create KB document with raw content
    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        tenantId,
        title,
        content: result.content,
        docType: 'GENERAL', // Will be changed to SERVICE later in P0-2B
        isActive: true,
      },
    });

    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      docType: doc.docType,
      wordCount: result.metadata?.wordCount || 0,
      charCount: result.metadata?.charCount || 0,
    };
  }
}
