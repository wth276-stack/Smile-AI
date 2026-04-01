import { Injectable } from '@nestjs/common';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import type { BookingDraft, KnowledgeChunk } from '@ats/ai-engine';

@Injectable()
export class KnowledgeRetrieverService {
  constructor(private readonly kb: KnowledgeBaseService) {}

  async retrieveForMessage(
    tenantId: string,
    message: string,
    bookingDraft?: BookingDraft,
  ): Promise<KnowledgeChunk[]> {
    const docs = await this.kb.search(tenantId, message);

    if (bookingDraft?.serviceDisplayName) {
      const contextDocs = await this.kb.search(tenantId, bookingDraft.serviceDisplayName);
      const existingIds = new Set(docs.map((d: any) => d.id));
      for (const doc of contextDocs) {
        if (!existingIds.has(doc.id)) docs.push(doc);
      }
    }

    return docs.map((d: any) => ({
      documentId: d.id,
      title: d.title,
      content: d.content,
      score: 1.0,
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
      faqItems: d.faqItems,
    }));
  }
}
