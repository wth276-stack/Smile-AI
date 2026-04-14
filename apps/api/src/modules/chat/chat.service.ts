import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { KnowledgeRetrieverService } from './knowledge-retriever.service';
import { ChatPersistenceService } from './chat-persistence.service';
import { runAiEngine } from '@ats/ai-engine';
import type { AiEngineInput, AiEngineResult, BookingDraft } from '@ats/ai-engine';
import { getConversationBookingState, updateBookingDraft, mergeConversationMetadata } from '@ats/database';
import type { ChatMessageDto } from './dto/chat-message.dto';
import type { PublicChatDto } from './dto/public-chat.dto';

const FALLBACK_REPLY = '收到你嘅訊息，我哋同事會盡快回覆你，感謝耐心等候！';

/** V2: prefer full LLM JSON from metadata for engine history (preserves action). Legacy rows use plain content. */
function messageContentForAiEngine(m: { sender: string; content: string; metadata: unknown }): string {
  if (m.sender !== 'AI') return m.content;
  const meta = m.metadata as Record<string, unknown> | null | undefined;
  const raw = meta && typeof meta.rawLlmJson === 'string' ? meta.rawLlmJson.trim() : '';
  return raw.length > 0 ? raw : m.content;
}

/** Store raw LLM JSON in Message.metadata.rawLlmJson for next-turn V2 context; fallback synthetic JSON if needed. */
function buildAiMessageMetadata(result: AiEngineResult): Prisma.InputJsonValue | undefined {
  const r = result as AiEngineResult & { _rawLlmJson?: string; _v2Action?: string };
  const raw = r._rawLlmJson;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return { rawLlmJson: raw };
  }
  if (typeof r._v2Action === 'string' && result.replyText) {
    return {
      rawLlmJson: JSON.stringify({
        reply: result.replyText,
        action: r._v2Action,
        intent: result.signals?.intents?.[0] ?? 'OTHER',
      }),
    };
  }
  return undefined;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly knowledgeRetriever: KnowledgeRetrieverService,
    private readonly persistence: ChatPersistenceService,
  ) {}

  /**
   * Public embed chat: tenant id = tenantSlug (no separate slug column).
   * Reuses handleInboundMessage — same contact+conversation resolution as authenticated chat.
   */
  async handlePublicMessage(dto: PublicChatDto): Promise<{ reply: string; conversationId: string }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantSlug.trim() } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    let externalContactId: string;

    if (dto.conversationId?.trim()) {
      const conv = await this.prisma.conversation.findFirst({
        where: { id: dto.conversationId.trim(), tenantId: tenant.id },
        include: { contact: true },
      });
      if (!conv) {
        throw new NotFoundException('Conversation not found');
      }
      const ext = conv.contact.externalIds as Record<string, unknown> | null;
      const web = ext && typeof ext === 'object' && ext !== null ? ext.webchat : undefined;
      if (typeof web !== 'string' || !web.trim()) {
        throw new NotFoundException('Invalid contact for conversation');
      }
      externalContactId = web;
    } else {
      externalContactId = `webpub-${randomUUID()}`;
    }

    const result = await this.handleInboundMessage({
      tenantId: tenant.id,
      channel: 'WEBCHAT',
      externalContactId,
      contactName: 'Website Visitor',
      message: dto.message.trim(),
    });

    return {
      reply: result.reply,
      conversationId: result.conversationId,
    };
  }

  async handleInboundMessage(dto: ChatMessageDto) {
    const { tenantId, channel, externalContactId, contactName, message } = dto;
    const isDemoChat =
      tenantId === 'demo-tenant' && channel === 'WEBCHAT' && (contactName ?? '') === 'Demo User';

    const contact = await this.contacts.resolveOrCreate(tenantId, externalContactId, contactName);

    const conversation = await this.conversations.resolveOrCreate(
      tenantId,
      contact.id,
      channel as any,
      externalContactId,
    );

    await this.conversations.addMessage(conversation.id, 'CUSTOMER', message);

    let recentMessages = await this.conversations.getRecentMessages(conversation.id, 20);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    const conversationState = await this.persistence.loadConversationState(conversation.id);
    const metaState = await getConversationBookingState(conversation.id);
    const bookingDraftMeta = metaState.bookingDraft as BookingDraft | null | undefined;
    const {
      bookingDraft: bookingDraftFromRun,
      conversationMode,
      confirmationPending: confirmationFromRun,
      conversationStage,
      customerEmotion,
      customerResistance,
      customerReadiness,
      customerTrust,
      customerStyle,
    } = conversationState;

    let bookingDraft = (bookingDraftMeta ?? bookingDraftFromRun) as BookingDraft | undefined;
    const confirmationPending = metaState.confirmationPending || confirmationFromRun;

    // --- Session cutoff: detect stale completed booking + new booking intent ---
    const allSlotsFilled = bookingDraft?.serviceName && bookingDraft?.date
      && bookingDraft?.time && bookingDraft?.customerName && bookingDraft?.phone;
    const isNewBookingIntent = /想預約|想book|預約|想做|book|我要預約/.test(message);
    if (allSlotsFilled && isNewBookingIntent) {
      this.logger.log(`Session cutoff: clearing stale draft + writing contextResetAt for conv=${conversation.id}`);
      await updateBookingDraft(conversation.id, undefined, false);
      await mergeConversationMetadata(conversation.id, {
        contextResetAt: new Date().toISOString(),
      });
      bookingDraft = undefined;
      recentMessages = [];
    } else {
      // Apply contextResetAt cutoff from a previous reset (for subsequent turns)
      const convRecord = await this.prisma.conversation.findUnique({
        where: { id: conversation.id },
        select: { metadata: true },
      });
      const meta = convRecord?.metadata as Record<string, unknown> | null;
      const cutoff = meta?.contextResetAt as string | undefined;
      if (cutoff) {
        const cutoffTime = new Date(cutoff).getTime();
        recentMessages = recentMessages.filter(
          (m) => m.createdAt.getTime() >= cutoffTime,
        );
      }
    }

    const knowledge = await this.knowledgeRetriever.retrieveForMessage(
      tenantId,
      message,
      bookingDraft,
    );

    console.log(
      '[KB DEBUG] knowledge.length:',
      knowledge.length,
      '| titles:',
      knowledge.map((k) => k.title ?? k.documentId),
    );

    const kbTitles = knowledge.map((k) => k.title);
    this.logger.log(
      `[KB retrieve] tenant=${tenantId} conv=${conversation.id} len=${knowledge.length} titles=${JSON.stringify(kbTitles)}`,
    );

    const aiInput: AiEngineInput = {
      tenant: {
        id: tenant.id,
        plan: tenant.plan,
        settings: tenant.settings as Record<string, unknown>,
      },
      contact: {
        id: contact.id,
        name: contact.name ?? undefined,
        tags: contact.tags,
      },
      conversation: {
        id: conversation.id,
        channel: channel as any,
        messageCount: recentMessages.length,
      },
      messages: recentMessages.map((m) => ({
        sender: m.sender as 'CUSTOMER' | 'AI' | 'HUMAN',
        content: messageContentForAiEngine(m),
        createdAt: m.createdAt.toISOString(),
      })),
      currentMessage: message,
      knowledge,
      bookingDraft,
      activeBookingId: bookingDraft?.bookingId ?? undefined,
      signals: {
        conversationMode,
        confirmationPending,
        // Decision Engine v1: pass previous signals for context
        conversationStage,
        customerEmotion,
        customerResistance,
        customerReadiness,
        customerTrust,
        customerStyle,
      } as any,
    };

    let result: Awaited<ReturnType<typeof runAiEngine>>;
    try {
      result = await runAiEngine(aiInput);
    } catch (err) {
      this.logger.error(
        `runAiEngine failed: tenant=${tenantId} conv=${conversation.id} err=${err instanceof Error ? err.message : String(err)}`,
      );
      await this.conversations.addMessage(conversation.id, 'AI', FALLBACK_REPLY);
      return {
        reply: FALLBACK_REPLY,
        conversationId: conversation.id,
        contactId: contact.id,
        sideEffects: [],
        sideEffectFailures: [],
      };
    }

    const effectExecution = await this.persistence.executeSideEffects(
      tenantId,
      contact.id,
      result.sideEffects,
      result.signals?.bookingDraft,
    );

    await this.conversations.addMessage(
      conversation.id,
      'AI',
      result.replyText,
      buildAiMessageMetadata(result),
    );
    await this.persistence.saveAiRun(tenantId, conversation.id, result, effectExecution);

    try {
      await updateBookingDraft(
        conversation.id,
        result.signals.bookingDraft as Prisma.InputJsonValue | undefined,
        !!result.signals.confirmationPending,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to update conversation booking metadata: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.persistence.resetConfirmationPendingAfterBookingEffects(conversation.id, effectExecution);

    // Decision Engine v1: Log stage and signals for debugging
    const sig = result.signals as any;
    this.logger.log(
      `Chat processed: tenant=${tenantId} conv=${conversation.id} ` +
      `mode=${sig.conversationMode ?? 'unknown'} ` +
      `stage=${sig.conversationStage ?? 'unknown'} ` +
      `emotion=${sig.customerEmotion ?? 'unknown'} ` +
      `readiness=${sig.customerReadiness ?? 'unknown'} ` +
      `trust=${sig.customerTrust ?? 'unknown'} ` +
      `strategy=${sig.strategy ?? 'unknown'} ` +
      `intents=${result.signals.intents} ` +
      `aiRunStatus=${effectExecution.failures.some((f) =>
        ['CREATE_BOOKING', 'MODIFY_BOOKING', 'CANCEL_BOOKING'].includes(f.effect.type),
      )
        ? 'ERROR'
        : 'SUCCESS'}`,
    );

    return {
      reply: result.replyText,
      conversationId: conversation.id,
      contactId: contact.id,
      sideEffects: effectExecution.succeeded,
      sideEffectFailures: effectExecution.failures,
      enginePath: isDemoChat ? result.enginePath : undefined,
      fallbackReason: isDemoChat ? result.fallbackReason : undefined,
    };
  }
}
