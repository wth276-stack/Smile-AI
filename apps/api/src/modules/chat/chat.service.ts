import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { KnowledgeRetrieverService } from './knowledge-retriever.service';
import { ChatPersistenceService } from './chat-persistence.service';
import { runAiEngine } from '@ats/ai-engine';
import type { AiEngineInput, AiEngineResult } from '@ats/ai-engine';
import type { ChatMessageDto } from './dto/chat-message.dto';

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

    const recentMessages = await this.conversations.getRecentMessages(conversation.id, 20);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    // Load full conversation state (draft + mode + confirmationPending + signals)
    const conversationState = await this.persistence.loadConversationState(conversation.id);
    const {
      bookingDraft,
      conversationMode,
      confirmationPending,
      // Decision Engine v1: load customer signals
      conversationStage,
      customerEmotion,
      customerResistance,
      customerReadiness,
      customerTrust,
      customerStyle,
    } = conversationState;

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
    );

    await this.conversations.addMessage(
      conversation.id,
      'AI',
      result.replyText,
      buildAiMessageMetadata(result),
    );
    await this.persistence.saveAiRun(tenantId, conversation.id, result, effectExecution);

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
