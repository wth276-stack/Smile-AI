import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import type { BookingDraft, KnowledgeChunk } from '@ats/ai-engine';

const DEFAULT_KB_TOP_K = 8;
const MAX_KB_TOP_K = 20;

type RetrieverDoc = {
  id: string;
  title: string;
  aliases?: string[] | null;
  updatedAt?: Date;
};

function resolveKbTopK(): number {
  const raw = process.env.ATS_KB_TOP_K ?? process.env.KB_TOP_K;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_KB_TOP_K;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_KB_TOP_K;
  return Math.min(parsed, MAX_KB_TOP_K);
}

function normalisePinText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '').trim();
}

function isDraftServiceDoc(doc: RetrieverDoc, draftService: string | null): boolean {
  if (!draftService) return false;
  const needle = normalisePinText(draftService);
  if (!needle) return false;
  const titles = [doc.title, ...(doc.aliases ?? [])].filter(Boolean);
  return titles.some((t) => {
    const hay = normalisePinText(t);
    return hay.includes(needle) || needle.includes(hay);
  });
}

export function selectTopKnowledgeDocuments<T extends RetrieverDoc>(
  docs: T[],
  scoresByDocId: Record<string, number>,
  options: { topK?: number; draftService?: string | null } = {},
): T[] {
  const topK = options.topK ?? resolveKbTopK();
  const draftService = options.draftService?.trim() || null;

  return [...docs]
    .map((doc, index) => ({
      doc,
      index,
      score: scoresByDocId[doc.id] ?? 0,
      pinned: isDraftServiceDoc(doc, draftService),
      updatedAtMs: doc.updatedAt?.getTime() ?? 0,
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      if (b.updatedAtMs !== a.updatedAtMs) return b.updatedAtMs - a.updatedAtMs;
      return a.index - b.index;
    })
    .slice(0, Math.max(1, topK))
    .map((r) => r.doc);
}

@Injectable()
export class KnowledgeRetrieverService {
  private readonly logger = new Logger(KnowledgeRetrieverService.name);

  constructor(private readonly kb: KnowledgeBaseService) {}

  async retrieveForMessage(
    tenantId: string,
    message: string,
    bookingDraft?: BookingDraft,
  ): Promise<KnowledgeChunk[]> {
    const { docs: d0, scoresByDocId: s0, debug: debug0 } = await this.kb.searchWithDebug(
      tenantId,
      message,
    );
    const docs = [...d0];
    const scoreMap = { ...s0 } as Record<string, number>;
    if (debug0) {
      this.logger.log(
        `[kb-retrieve] user msg q=${JSON.stringify(message)} ` +
          `steps=${JSON.stringify(
            debug0.steps?.map((st) => ({
              n: st.name,
              nRes: st.resultCount,
              min: st.minDocScore,
              top: st.topScores?.slice(0, 3),
            })),
          )} final=${debug0.finalFallback}`,
      );
    }

    if (bookingDraft?.serviceDisplayName) {
      const { docs: cDocs, scoresByDocId: cScores } = await this.kb.searchWithDebug(
        tenantId,
        bookingDraft.serviceDisplayName,
      );
      this.logger.log(
        `[kb-retrieve] merge bookingDraft.serviceDisplayName=${JSON.stringify(bookingDraft.serviceDisplayName)} ` +
          `docsAdded=${cDocs.filter((d) => !s0[d.id]).length}`,
      );
      const existingIds = new Set(docs.map((d) => d.id));
      for (const doc of cDocs) {
        if (existingIds.has(doc.id)) continue;
        existingIds.add(doc.id);
        docs.push(doc);
        const sc = cScores[doc.id] ?? 0.4;
        scoreMap[doc.id] = Math.max(scoreMap[doc.id] ?? 0, sc);
      }
    }

    const draftService =
      bookingDraft?.serviceDisplayName?.trim() || bookingDraft?.serviceName?.trim() || null;
    const selectedDocs = selectTopKnowledgeDocuments(docs, scoreMap, {
      draftService,
    });
    this.logger.log(
      `[kb-retrieve] topK=${selectedDocs.length}/${docs.length} ` +
        `draftPinned=${draftService ? JSON.stringify(draftService) : 'null'} ` +
        `titles=${JSON.stringify(selectedDocs.map((d) => d.title))}`,
    );

    return selectedDocs.map((d) => ({
      documentId: d.id,
      title: d.title,
      content: d.content,
      score: scoreMap[d.id] ?? 0.1,
      // Service aliases for matching
      aliases: d.aliases || [],
      // Structured fields (Phase 1.5C)
      effect: d.effect,
      suitable: d.suitable,
      unsuitable: d.unsuitable,
      precaution: d.precaution,
      duration: d.duration,
      // Pricing fields (Phase 1.5D)
      price: d.price,
      discountPrice: d.discountPrice,
      // Steps field (Phase 1.5D)
      steps: d.steps,
      // FAQ items (Phase 1.5D)
      faqItems: d.faqItems as KnowledgeChunk['faqItems'],
    }));
  }
}
