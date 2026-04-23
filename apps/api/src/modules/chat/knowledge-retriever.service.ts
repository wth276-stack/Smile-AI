import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import type { BookingDraft, KnowledgeChunk } from '@ats/ai-engine';

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

    return docs.map((d) => ({
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
