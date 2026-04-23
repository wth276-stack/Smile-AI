import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { KnowledgeRetrieverService } from './knowledge-retriever.service';
import { ChatPersistenceService } from './chat-persistence.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import {
  bookingDraftHasAllRequiredSlots,
  emptyDraft,
  extractSlots,
  provisionalCustomerNameFromExistingBookings,
  runAiEngine,
} from '@ats/ai-engine';
import type { AiEngineInput, AiEngineResult, BookingDraft } from '@ats/ai-engine';
import {
  getConversationBookingState,
  updateBookingDraft,
  mergeConversationMetadata,
  isDemoIndustryTenantId,
  getDemoTenantIdForIndustryId,
} from '@ats/database';
import type { ChatMessageDto } from './dto/chat-message.dto';
import type { PublicChatDto } from './dto/public-chat.dto';
import { shouldEscapeStaleConfirmation } from './stale-confirmation-escape';
import { buildAiMessageMetadata, messageContentForAiEngine } from './ai-message-metadata';
import { resolveModifyFlowBookingLookup } from './booking-lookup-mode';
import {
  baseWhatsappIdForPhone,
  parseTestSessionAllowlist,
  parseWhatsappTestSession,
} from './whatsapp-test-session-override';

const FALLBACK_REPLY = '收到你嘅訊息，我哋同事會盡快回覆你，感謝耐心等候！';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
    private readonly knowledgeRetriever: KnowledgeRetrieverService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly persistence: ChatPersistenceService,
  ) {}

  /**
   * Public embed chat: tenant id = tenantSlug (no separate slug column).
   * Reuses handleInboundMessage — same contact+conversation resolution as authenticated chat.
   * Returns the same payload as /api/chat/message (including enginePath / fallbackReason when isDemoChat).
   */
  async handlePublicMessage(dto: PublicChatDto): Promise<{
    reply: string;
    conversationId: string;
    contactId: string;
    sideEffects: unknown;
    sideEffectFailures: unknown;
    enginePath?: string;
    fallbackReason?: string;
  }> {
    const fromIndustry = dto.industryId?.trim();
    const resolvedId = fromIndustry
      ? getDemoTenantIdForIndustryId(fromIndustry)
      : (dto.tenantSlug ?? '').trim();
    if (fromIndustry && !resolvedId) {
      throw new BadRequestException(`Unknown industryId: ${fromIndustry}`);
    }
    if (!resolvedId) {
      throw new BadRequestException('Provide tenantSlug or industryId');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: resolvedId } });
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

    return this.handleInboundMessage({
      tenantId: tenant.id,
      channel: 'WEBCHAT',
      externalContactId,
      contactName: 'Website Visitor',
      message: dto.message.trim(),
    });
  }

  async handleInboundMessage(dto: ChatMessageDto) {
    const { tenantId, channel, contactName } = dto;
    let { externalContactId, message } = dto;
    // Debug fields (enginePath, fallbackReason) for all five industry demo tenants — see
    // isDemoIndustryTenantId() in @ats/database (not hardcoded to demo-tenant only).
    const isDemoChat =
      isDemoIndustryTenantId(tenantId) &&
      channel === 'WEBCHAT' &&
      ((contactName ?? '') === 'Demo User' || (contactName ?? '') === 'Website Visitor');

    /** When true, booking lookup must not match other sessions that share the same wa_id digits. */
    let whatsappTestSessionActive = false;

    if (channel === 'WHATSAPP') {
      const testSessionEnabled = process.env.WHATSAPP_TEST_SESSION_ENABLED === 'true';
      const testSessionAllowlist = parseTestSessionAllowlist(process.env.WHATSAPP_TEST_SESSION_ALLOWLIST);
      const parsed = parseWhatsappTestSession(
        externalContactId,
        message,
        testSessionEnabled,
        testSessionAllowlist,
      );
      if (parsed.activated) {
        whatsappTestSessionActive = true;
        this.logger.log(
          `WhatsApp test session: wa_id=${externalContactId} sessionKey=${parsed.sessionKey} ` +
            `externalContactId=${parsed.externalContactId}`,
        );
        externalContactId = parsed.externalContactId;
        message = parsed.messageText;
      }
    }

    const contact = await this.contacts.resolveOrCreate(tenantId, externalContactId, contactName, channel);

    const conversation = await this.conversations.resolveOrCreate(
      tenantId,
      contact.id,
      channel as any,
      externalContactId,
    );

    const convRecordEarly = await this.prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: { metadata: true },
    });
    const convMeta = (convRecordEarly?.metadata as Record<string, unknown> | null) ?? {};

    await this.conversations.addMessage(conversation.id, 'CUSTOMER', message);

    let recentMessages = await this.conversations.getRecentMessages(conversation.id, 20);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    const conversationState = await this.persistence.loadConversationState(conversation.id);
    const metaState = await getConversationBookingState(conversation.id);
    const {
      bookingDraft: bookingDraftFromRun,
      conversationMode,
      confirmationPending: confirmationFromRun,
      lastIntents = [],
      conversationStage,
      customerEmotion,
      customerResistance,
      customerReadiness,
      customerTrust,
      customerStyle,
    } = conversationState;

    let bookingDraft: BookingDraft | undefined;
    if (metaState.bookingDraftExplicit === undefined) {
      bookingDraft = bookingDraftFromRun as BookingDraft | undefined;
    } else if (metaState.bookingDraftExplicit === null) {
      bookingDraft = undefined;
    } else {
      bookingDraft = metaState.bookingDraftExplicit as unknown as BookingDraft;
    }

    let confirmationPending =
      metaState.confirmationPendingExplicit !== null
        ? metaState.confirmationPendingExplicit
        : confirmationFromRun;

    // --- Session cutoff: detect stale completed booking + new booking intent ---
    const allSlotsFilled = bookingDraft && bookingDraftHasAllRequiredSlots(bookingDraft);
    const isNewBookingIntent =
      /想預約|想約|book|預約|想做|我要約|幫我約|想book|new booking|我要預約/i.test(message);
    if (allSlotsFilled && isNewBookingIntent) {
      this.logger.log(`Session cutoff: clearing stale draft + writing contextResetAt for conv=${conversation.id}`);
      await updateBookingDraft(conversation.id, null, false);
      await mergeConversationMetadata(conversation.id, {
        contextResetAt: new Date().toISOString(),
        modifyCancelFlow: false,
      });
      bookingDraft = undefined;
      confirmationPending = false;
      recentMessages = [];
    } else {
      // Apply contextResetAt cutoff from a previous reset (for subsequent turns)
      const cutoff = convMeta.contextResetAt as string | undefined;
      if (cutoff) {
        const cutoffTime = new Date(cutoff).getTime();
        recentMessages = recentMessages.filter(
          (m) => m.createdAt.getTime() >= cutoffTime,
        );
      }
    }

    // --- Stale confirmation escape: FAQ / price / info while waiting for booking confirm ---
    // For modify/cancel pending, keep booking draft + bookingId; only clear confirmation flag.
    if (
      confirmationPending &&
      bookingDraft &&
      bookingDraftHasAllRequiredSlots(bookingDraft) &&
      shouldEscapeStaleConfirmation(message)
    ) {
      const isModifyOrCancelPending =
        bookingDraft.mode === 'modify' || bookingDraft.mode === 'cancel';
      this.logger.log(
        `[chat.service] Stale confirmation escaped — user sent FAQ/info query during pending confirmation ` +
          `conv=${conversation.id} modifyOrCancel=${isModifyOrCancelPending}`,
      );
      if (isModifyOrCancelPending) {
        await updateBookingDraft(conversation.id, bookingDraft as unknown as Prisma.InputJsonValue, false);
      } else {
        await updateBookingDraft(conversation.id, null, false);
        bookingDraft = undefined;
      }
      confirmationPending = false;
    }

    const extracted = extractSlots(message);

    const modifyCancelKeywords =
      /改期|取消|取消預約|cancel|reschedule|改時間|修改預約|我想改|想改期|改到|改.*(星期|禮拜|幾[點時]|號|日)|轉(成|到|日|期)|挪期|夾(檔|期)|星期|禮拜|唔要個booking|取消booking|換(日|期|時間)/i;
    const wantsModifyCancelContext =
      modifyCancelKeywords.test(message) ||
      lastIntents.some((i) => i === 'BOOKING_CHANGE' || i === 'BOOKING_CANCEL');

    let modifyCancelFlow = Boolean(convMeta.modifyCancelFlow);
    if (wantsModifyCancelContext) {
      modifyCancelFlow = true;
      await mergeConversationMetadata(conversation.id, { modifyCancelFlow: true });
    }

    /** 改期／取消 flow：一旦進入 modifyCancelFlow（或相關 intent），必跑 lookup；有電話用電話，冇電話用 conversation contactId。 */
    const shouldLookupExisting =
      modifyCancelFlow ||
      wantsModifyCancelContext ||
      lastIntents.some((i) => i === 'BOOKING_CHANGE' || i === 'BOOKING_CANCEL');

    const emptyDraftBase: BookingDraft = {
      bookingId: null,
      mode: null,
      serviceName: null,
      serviceDisplayName: null,
      date: null,
      time: null,
      customerName: null,
      phone: null,
    };

    // WhatsApp auto-fill: wa_id is the sender's phone; strip "852" country prefix for HK
    const waIdForPhone = channel === 'WHATSAPP' ? baseWhatsappIdForPhone(externalContactId) : null;
    const waPhone = waIdForPhone
      ? waIdForPhone.replace(/^852/, '').replace(/[^0-9]/g, '') || waIdForPhone
      : null;

    const phoneForLookup = (bookingDraft?.phone?.trim() || extracted.phone?.trim() || waPhone || '').trim();

    let bookingDraftForEngine: BookingDraft = {
      ...(bookingDraft ?? emptyDraftBase),
      phone: bookingDraft?.phone ?? extracted.phone ?? waPhone ?? null,
    };

    if (wantsModifyCancelContext || modifyCancelFlow) {
      const cancelIntent =
        /取消|cancel/i.test(message) || lastIntents.some((i) => i === 'BOOKING_CANCEL');
      bookingDraftForEngine = {
        ...bookingDraftForEngine,
        mode: cancelIntent ? 'cancel' : bookingDraftForEngine.mode ?? 'modify',
      };
    }

    let existingBookings: AiEngineInput['existingBookings'] | undefined;
    let bookingLookupEmpty: boolean | undefined;
    let bookingLookupPhone: string | null | undefined;

    if (shouldLookupExisting) {
      // Production: match upcoming rows by conversation contact OR shared phone (last 8).
      // WhatsApp #test:blockX: each session is a separate contact; phone scan would pull in
      // bookings from block1/block2 under the same wa_id — scope to this contact only.
      const { lookupPhone, lookupMode } = resolveModifyFlowBookingLookup({
        whatsappTestSessionActive,
        phoneForLookup,
      });
      const rows = await this.lookupUpcomingBookings(tenantId, lookupPhone, contact.id);
      existingBookings = rows.map((b) => ({
        id: b.id,
        serviceName: b.serviceName,
        startTime: b.startTime,
        endTime: b.endTime,
        status: b.status,
        customerName: b.customerName,
      }));
      const displayPhone =
        phoneForLookup.length >= 8
          ? phoneForLookup
          : contact.phone?.trim() ||
            rows.find((r) => r.phone?.trim())?.phone?.trim() ||
            '';
      bookingLookupPhone = displayPhone || phoneForLookup || undefined;
      if (rows.length === 0) bookingLookupEmpty = true;
      if (rows.length === 1 && !bookingDraftForEngine.bookingId) {
        const slots = this.bookingRowToDraftSlots(rows[0]);
        bookingDraftForEngine = {
          ...bookingDraftForEngine,
          ...slots,
          mode: bookingDraftForEngine.mode ?? 'modify',
        };
      }
      // One upcoming booking: natural reschedule phrasing (e.g. 改星期日十點) should enter modify even if keywords missed
      if (rows.length === 1 && !wantsModifyCancelContext) {
        const m = message.trim();
        const soleReschedulePhrasing =
          /改(?!期|做|名|電)|轉(成|到)|想改|挪期|夾(檔|期)/.test(m) ||
          (/(?:星期|禮拜|幾[點時]|am|pm|\d+號)/i.test(m) && /[改轉揀]/.test(m));
        if (soleReschedulePhrasing) {
          await mergeConversationMetadata(conversation.id, { modifyCancelFlow: true });
          modifyCancelFlow = true;
          bookingDraftForEngine = {
            ...bookingDraftForEngine,
            mode: bookingDraftForEngine.mode === 'cancel' ? 'cancel' : 'modify',
          };
          if (!bookingDraftForEngine.bookingId) {
            const slots = this.bookingRowToDraftSlots(rows[0]);
            bookingDraftForEngine = { ...bookingDraftForEngine, ...slots, mode: 'modify' };
          }
        }
      }
      this.logger.log(
        `[chat.service] Booking lookup lookupMode=${lookupMode} tenant=${tenantId} conv=${conversation.id} contact=${contact.id} phone=${bookingLookupPhone ?? '(none)'} count=${rows.length}`,
      );
    } else {
      // Live path: modify keywords absent — still load contact-scoped upcoming rows so
      // provisionalCustomerNameFromExistingBookings can hydrate (else existingBookings stayed undefined).
      const rows = await this.lookupUpcomingBookings(tenantId, null, contact.id);
      if (rows.length > 0) {
        existingBookings = rows.map((b) => ({
          id: b.id,
          serviceName: b.serviceName,
          startTime: b.startTime,
          endTime: b.endTime,
          status: b.status,
          customerName: b.customerName,
        }));
        this.logger.log(
          `[chat.service] Booking lookup lookupMode=contact-only tenant=${tenantId} conv=${conversation.id} contact=${contact.id} count=${rows.length} (hydration)`,
        );
      }
    }

    const rememberedName = provisionalCustomerNameFromExistingBookings(
      bookingDraftForEngine,
      existingBookings,
    );
    if (rememberedName && !bookingDraftForEngine.customerName?.trim()) {
      bookingDraftForEngine = { ...bookingDraftForEngine, customerName: rememberedName };
    }
    if (
      process.env.ATS_DEBUG_BOOKING_PATH === '1' ||
      process.env.ATS_DEBUG_BOOKING_PATH === 'true'
    ) {
      this.logger.warn(
        `[chat.service trace] nameHydration provisionalCustomerNameFromExistingBookings ` +
          `returned=${rememberedName ?? 'null'} ` +
          `draftName=${bookingDraftForEngine.customerName ?? 'null'} ` +
          `existingBookingsCount=${existingBookings?.length ?? 0} ` +
          `shouldLookupExisting=${shouldLookupExisting} ` +
          `bookingId=${bookingDraftForEngine.bookingId ?? 'null'}`,
      );
    }

    const [knowledge, authorisedServiceCatalog] = await Promise.all([
      this.knowledgeRetriever.retrieveForMessage(
        tenantId,
        message,
        bookingDraftForEngine,
      ),
      this.knowledgeBase.listActiveServiceDisplayNames(tenantId),
    ]);

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

    if (
      process.env.ATS_DEBUG_BOOKING_PATH === '1' ||
      process.env.ATS_DEBUG_BOOKING_PATH === 'true'
    ) {
      this.logger.warn(
        `[chat.service trace] runAiEngine input draft.customerName=${bookingDraftForEngine.customerName ?? 'null'}`,
      );
    }

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
      ...(authorisedServiceCatalog.length > 0 ? { authorisedServiceCatalog } : {}),
      bookingDraft: bookingDraftForEngine,
      ...(existingBookings !== undefined
        ? {
            existingBookings,
            ...(bookingLookupPhone ? { bookingLookupPhone } : {}),
            ...(bookingLookupEmpty ? { bookingLookupEmpty: true } : {}),
          }
        : {}),
      activeBookingId: bookingDraftForEngine.bookingId ?? undefined,
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

    // Persist cleared draft on successful create so the next turn does not fall back to a
    // full bookingDraft from the last AiRun (loadConversationState) and re-trigger SUBMIT_BOOKING.
    const createSucceeded = effectExecution.succeeded.some((e) => e.type === 'CREATE_BOOKING');
    if (createSucceeded && result.signals && typeof result.signals === 'object') {
      const sig = result.signals as { bookingDraft?: BookingDraft; confirmationPending?: boolean };
      sig.bookingDraft = emptyDraft();
      sig.confirmationPending = false;
    }

    const hadBookingMutation = effectExecution.succeeded.some((e) =>
      ['CREATE_BOOKING', 'MODIFY_BOOKING', 'CANCEL_BOOKING'].includes(e.type),
    );
    if (hadBookingMutation) {
      try {
        await mergeConversationMetadata(conversation.id, { modifyCancelFlow: false });
      } catch (err) {
        this.logger.warn(
          `mergeConversationMetadata modifyCancelFlow: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

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
    const v2a = (result as AiEngineResult & { _v2Action?: string })._v2Action;
    this.logger.log(
      `Chat processed: tenant=${tenantId} conv=${conversation.id} ` +
      `legacyAction=${String(sig?.action ?? 'unknown')} ` +
      `v2Action=${v2a ?? 'unknown'} ` +
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

  private normalizePhoneDigits(s: string): string {
    return s.replace(/\D/g, '');
  }

  private formatDateHkYmd(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  private formatTimeHk(d: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Hong_Kong',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  }

  /** Map DB booking row → draft slots for modify/cancel (single upcoming match). */
  private bookingRowToDraftSlots(row: {
    id: string;
    serviceName: string;
    startTime: Date;
    customerName: string | null;
    phone: string | null;
  }): Pick<
    BookingDraft,
    | 'bookingId'
    | 'serviceName'
    | 'serviceDisplayName'
    | 'date'
    | 'time'
    | 'customerName'
    | 'phone'
  > {
    return {
      bookingId: row.id,
      serviceName: row.serviceName,
      serviceDisplayName: row.serviceName,
      date: this.formatDateHkYmd(row.startTime),
      time: this.formatTimeHk(row.startTime),
      customerName: row.customerName?.trim() ?? null,
      phone: row.phone?.trim() ?? null,
    };
  }

  private getHktStartOfToday(): Date {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    return new Date(`${y}-${m}-${d}T00:00:00+08:00`);
  }

  /**
   * Upcoming bookings for modify/cancel:
   * - No usable phone digits: query by conversation `contactId` only (same-session flow after SUBMIT clears draft).
   * - Phone ≥8 digits: scan + match contactId OR phone (last 8) on booking / linked contact.
   */
  private async lookupUpcomingBookings(
    tenantId: string,
    phone: string | null,
    conversationContactId: string,
  ): Promise<
    Array<{
      id: string;
      serviceName: string;
      startTime: Date;
      endTime: Date | null;
      status: string;
      customerName: string | null;
      phone: string | null;
    }>
  > {
    const hktStart = this.getHktStartOfToday();
    const digits = this.normalizePhoneDigits(phone ?? '');

    const mapRow = (b: {
      id: string;
      serviceName: string;
      startTime: Date;
      endTime: Date | null;
      status: string;
      customerName: string | null;
      phone: string | null;
    }) => ({
      id: b.id,
      serviceName: b.serviceName,
      startTime: b.startTime,
      endTime: b.endTime,
      status: b.status,
      customerName: b.customerName,
      phone: b.phone,
    });

    if (digits.length < 8) {
      const rows = await this.prisma.booking.findMany({
        where: {
          tenantId,
          contactId: conversationContactId,
          status: { not: 'CANCELLED' },
          startTime: { gte: hktStart },
        },
        orderBy: { startTime: 'asc' },
        take: 10,
        select: {
          id: true,
          serviceName: true,
          startTime: true,
          endTime: true,
          status: true,
          customerName: true,
          phone: true,
        },
      });
      return rows.map(mapRow);
    }

    const candidates = await this.prisma.booking.findMany({
      where: {
        tenantId,
        status: { not: 'CANCELLED' },
        startTime: { gte: hktStart },
      },
      orderBy: { startTime: 'asc' },
      take: 200,
      select: {
        id: true,
        serviceName: true,
        startTime: true,
        endTime: true,
        status: true,
        customerName: true,
        phone: true,
        contactId: true,
        contact: { select: { phone: true } },
      },
    });

    const last8 = digits.slice(-8);
    const matches = candidates.filter((b) => {
      if (b.contactId === conversationContactId) return true;
      const bp = b.phone ? this.normalizePhoneDigits(b.phone) : '';
      const cp = b.contact.phone ? this.normalizePhoneDigits(b.contact.phone) : '';
      if (bp && bp.slice(-8) === last8) return true;
      if (cp && cp.slice(-8) === last8) return true;
      return false;
    });

    return matches.slice(0, 10).map(mapRow);
  }
}
