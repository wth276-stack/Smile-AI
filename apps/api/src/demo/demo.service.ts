import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  applyIndustrySeedToTenant,
  getDemoTenantIdForIndustryId,
  getIndustrySeed,
  isDemoIndustryTenantId,
  updateBookingDraft,
} from '@ats/database';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class DemoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clear messages + booking state for a demo conversation (any industry tenant).
   * No-op if conversation missing (client may send stale id on industry switch).
   */
  private async resetConversationIfNeeded(conversationId: string | undefined): Promise<void> {
    if (!conversationId?.trim()) return;

    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId.trim() },
    });
    if (!conv) return;
    if (!isDemoIndustryTenantId(conv.tenantId)) {
      throw new BadRequestException('Conversation is not part of a demo tenant');
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
    options: { resetKnowledgeBase?: boolean } = {},
  ): Promise<{
    success: true;
    industry: string;
    servicesCount: number;
    kbCount: number;
    tenantId: string;
    knowledgeBaseReset: boolean;
    reset: {
      scope: string;
      whatChanged: string[];
      dataLoss: string;
    };
  }> {
    const tenantId = getDemoTenantIdForIndustryId(industryId.trim());
    if (!tenantId) {
      throw new BadRequestException(`Unknown industryId: ${industryId}`);
    }
    const seed = getIndustrySeed(industryId.trim());
    if (!seed) {
      throw new BadRequestException(`Unknown industryId: ${industryId}`);
    }

    await this.resetConversationIfNeeded(conversationId);

    if (options.resetKnowledgeBase === true) {
      const { servicesCount, kbCount, displayName } = await applyIndustrySeedToTenant(
        this.prisma,
        tenantId,
        industryId.trim(),
      );

      return {
        success: true,
        industry: displayName,
        servicesCount,
        kbCount,
        tenantId,
        knowledgeBaseReset: true,
        reset: {
          scope: 'This demo tenant was reset from canonical industry seed data.',
          whatChanged: [
            'All KnowledgeDocument rows for this tenant were replaced (FAQ + service articles).',
            'Tenant name and settings (persona, business hours, contact fields, businessType, structured hours) were overwritten from seed.',
          ],
          dataLoss: 'Any manual demo edits in the dashboard (KB, tenant settings) for this tenant are lost.',
        },
      };
    }

    const [servicesCount, kbCount] = await Promise.all([
      this.prisma.knowledgeDocument.count({
        where: { tenantId, isActive: true, docType: 'SERVICE' },
      }),
      this.prisma.knowledgeDocument.count({
        where: { tenantId, isActive: true },
      }),
    ]);

    return {
      success: true,
      industry: seed.displayName,
      servicesCount,
      kbCount,
      tenantId,
      knowledgeBaseReset: false,
      reset: {
        scope: 'Conversation state reset only. KnowledgeDocument rows were preserved.',
        whatChanged: [
          'If conversationId was supplied, customer/AI messages and AiRun rows for that demo conversation were cleared.',
          'Booking draft metadata for that conversation was cleared.',
        ],
        dataLoss: 'No KB rows or tenant settings were changed. Pass resetKnowledgeBase=true only when an intentional seed reset is required.',
      },
    };
  }

  /**
   * Point the WhatsApp test integration (one ChannelConfig row) at a demo industry tenant.
   * Deactivates any other WHATSAPP config on the target tenant to satisfy @@unique([tenantId, channel]).
   */
  async rebindWhatsAppToIndustry(
    industryId: string,
    channelConfigId?: string,
  ): Promise<{ tenantId: string; channelConfigId: string; industryId: string }> {
    const tenantId = getDemoTenantIdForIndustryId(industryId.trim());
    if (!tenantId) {
      throw new BadRequestException(`Unknown industryId: ${industryId}`);
    }

    const cfg = channelConfigId?.trim()
      ? await this.prisma.channelConfig.findFirst({ where: { id: channelConfigId.trim() } })
      : await this.prisma.channelConfig.findFirst({
          where: { channel: 'WHATSAPP', isActive: true },
          orderBy: { updatedAt: 'desc' },
        });

    if (!cfg) {
      throw new NotFoundException(
        'No WhatsApp ChannelConfig found. Pass channelConfigId or create an active WHATSAPP integration.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const others = await tx.channelConfig.findMany({
        where: {
          tenantId,
          channel: 'WHATSAPP',
          NOT: { id: cfg.id },
        },
      });
      for (const o of others) {
        await tx.channelConfig.update({
          where: { id: o.id },
          data: { isActive: false },
        });
      }
      await tx.channelConfig.update({
        where: { id: cfg.id },
        data: { tenantId, isActive: true },
      });
    });

    return { tenantId, channelConfigId: cfg.id, industryId: industryId.trim() };
  }
}
