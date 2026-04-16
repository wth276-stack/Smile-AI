import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocType } from '@prisma/client';
import { updateBookingDraft } from '@ats/database';
import { PrismaService } from '../common/prisma/prisma.service';
import { getIndustrySeed, type IndustryService } from './industry-seeds';

const DEMO_TENANT_ID = 'demo-tenant';

/** Maps industry seed id → tenant.settings.businessType (V2 prompt). */
const INDUSTRY_BUSINESS_TYPE: Record<string, string> = {
  beauty: 'beauty salon',
  cleaning: 'professional cleaning service',
  renovation: 'renovation and interior design',
  consulting: 'private consulting',
  fitness: 'fitness studio',
};

function mapIndustryToBusinessType(industryId: string): string {
  return INDUSTRY_BUSINESS_TYPE[industryId] ?? 'general business';
}

function buildServiceKbContent(svc: IndustryService): string {
  const faqLine = svc.faq.map((f) => `${f.q}: ${f.a}`).join(' / ');
  return `## ${svc.displayName}\n價錢: ${svc.price} | 時間: ${svc.duration}\n功效: ${svc.description}\n適合: ${svc.suitable}\n注意: ${svc.caution}\n常見問題: ${faqLine}`;
}

@Injectable()
export class DemoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reset a landing-page conversation: clear messages, AI run history, and booking metadata.
   * Must delete AiRun rows or loadConversationState would still restore old bookingDraft from signals.
   */
  private async resetConversationIfNeeded(conversationId: string | undefined): Promise<void> {
    if (!conversationId?.trim()) return;

    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId.trim(), tenantId: DEMO_TENANT_ID },
    });
    if (!conv) {
      throw new NotFoundException('Conversation not found');
    }

    await this.prisma.$transaction([
      this.prisma.message.deleteMany({ where: { conversationId: conv.id } }),
      this.prisma.aiRun.deleteMany({ where: { conversationId: conv.id } }),
    ]);

    await updateBookingDraft(conv.id, null, false);
  }

  async resetDemo(
    industryId: string,
    conversationId?: string,
  ): Promise<{
    success: true;
    industry: string;
    servicesCount: number;
    kbCount: number;
  }> {
    const seed = getIndustrySeed(industryId.trim());
    if (!seed) {
      throw new BadRequestException(`Unknown industryId: ${industryId}`);
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: DEMO_TENANT_ID },
    });

    await this.resetConversationIfNeeded(conversationId);

    const existingSettings = (tenant.settings as Record<string, unknown>) ?? {};

    const mergedSettings: Record<string, unknown> = {
      ...existingSettings,
      businessName: seed.displayName,
      assistantRole: seed.persona,
      businessHoursText: seed.businessHoursText,
      contactPhone: seed.contactPhone,
      contactWhatsApp: seed.contactWhatsApp,
      businessType: mapIndustryToBusinessType(seed.id),
    };

    await this.prisma.tenant.update({
      where: { id: DEMO_TENANT_ID },
      data: {
        name: seed.displayName,
        settings: mergedSettings as object,
      },
    });

    await this.prisma.knowledgeDocument.deleteMany({
      where: { tenantId: DEMO_TENANT_ID },
    });

    let kbCount = 0;

    for (const kb of seed.knowledgeBase) {
      await this.prisma.knowledgeDocument.create({
        data: {
          tenantId: DEMO_TENANT_ID,
          title: kb.title,
          content: kb.content,
          docType: DocType.FAQ,
          isActive: true,
        },
      });
      kbCount += 1;
    }

    for (const svc of seed.services) {
      const content = buildServiceKbContent(svc);
      // TODO: When KnowledgeDocument supports embeddings / vectors, call the same pipeline as admin KB create.
      await this.prisma.knowledgeDocument.create({
        data: {
          tenantId: DEMO_TENANT_ID,
          title: svc.displayName,
          content,
          docType: DocType.SERVICE,
          isActive: true,
          duration: svc.duration,
          effect: svc.description,
          suitable: svc.suitable,
          unsuitable: undefined,
          precaution: svc.caution,
          price: svc.price,
          aliases: [svc.name, svc.displayName],
          faqItems: svc.faq.map((f) => ({ question: f.q, answer: f.a })),
        },
      });
      kbCount += 1;
    }

    const servicesCount = seed.services.length;

    return {
      success: true,
      industry: seed.displayName,
      servicesCount,
      kbCount,
    };
  }
}
