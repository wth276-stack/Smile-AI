import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PaginationDto } from '../../common/dto/pagination.dto';

export interface ConversationSignals {
  conversationStage?: string;
  customerEmotion?: string;
  customerResistance?: string;
  customerReadiness?: number;
  customerTrust?: number;
  customerStyle?: string;
  strategy?: string;
  conversationMode?: string;
}

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, pagination: PaginationDto) {
    const { page = 1, pageSize = 20, sortOrder = 'desc' } = pagination;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { tenantId },
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, sender: true, createdAt: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: sortOrder },
        skip,
        take: pageSize,
      }),
      this.prisma.conversation.count({ where: { tenantId } }),
    ]);

    const mapped = items.map((c) => ({
      ...c,
      lastMessage: c.messages[0] || null,
      messageCount: c._count.messages,
      messages: undefined,
      _count: undefined,
    }));

    return { items: mapped, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findByIdWithMessages(tenantId: string, id: string) {
    return this.prisma.conversation.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        contact: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  /**
   * Find an OPEN conversation for this contact+channel, or create one.
   */
  async resolveOrCreate(tenantId: string, contactId: string, channel: any, externalId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId, channel, status: 'OPEN' },
    });

    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { tenantId, contactId, channel, externalId },
    });
  }

  async addMessage(conversationId: string, sender: 'CUSTOMER' | 'AI' | 'HUMAN', content: string) {
    const message = await this.prisma.message.create({
      data: { conversationId, sender, content },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  async getRecentMessages(conversationId: string, limit: number) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Get the latest AI signals for a conversation.
   * Returns customer emotion, trust, readiness, resistance, style, and strategy.
   */
  async getLatestSignals(conversationId: string): Promise<ConversationSignals> {
    const lastRun = await this.prisma.aiRun.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      select: { signals: true },
    });

    if (!lastRun?.signals) {
      return {};
    }

    const signals = lastRun.signals as Record<string, unknown>;
    return {
      conversationStage: signals.conversationStage as string | undefined,
      customerEmotion: signals.customerEmotion as string | undefined,
      customerResistance: signals.customerResistance as string | undefined,
      customerReadiness: signals.customerReadiness as number | undefined,
      customerTrust: signals.customerTrust as number | undefined,
      customerStyle: signals.customerStyle as string | undefined,
      strategy: signals.strategy as string | undefined,
      conversationMode: signals.conversationMode as string | undefined,
    };
  }
}
