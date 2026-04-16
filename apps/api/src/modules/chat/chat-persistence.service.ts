import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { BookingsService } from '../bookings/bookings.service';
import type { AiEngineResult, SideEffect, BookingDraft, DetectedSignals } from '@ats/ai-engine';
import { updateBookingDraft } from '@ats/database';

/** Outcome of executing engine side effects (auditable; drives AiRun.status). */
export interface SideEffectExecutionResult {
  succeeded: SideEffect[];
  failures: Array<{ effect: SideEffect; message: string }>;
}

/** Full conversation state loaded from last AiRun */
export interface ConversationState {
  bookingDraft: BookingDraft | undefined;
  conversationMode: string;
  confirmationPending: boolean;
  /** Last persisted AI intents (from previous turn signals) */
  lastIntents?: string[];
  // Decision Engine v1: Customer signals and strategy
  conversationStage?: string;
  customerEmotion?: string;
  customerResistance?: string;
  customerReadiness?: number;
  customerTrust?: number;
  customerStyle?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * When CREATE_BOOKING fails, do not persist a "complete" draft as if CRM succeeded:
 * clear date/time so the next turn re-collects slots, and stamp _integration for dashboards.
 */
/** Spreads full `signals` so V2 `_auditPreBoundary` is preserved on CREATE_BOOKING failure rows. */
function buildPersistedSignals(
  signals: DetectedSignals,
  bookingFailure: { message: string },
): Record<string, unknown> {
  const draft = signals.bookingDraft;
  return {
    ...(signals as unknown as Record<string, unknown>),
    _integration: {
      bookingPersisted: false,
      bookingError: bookingFailure.message,
    },
    bookingDraft:
      draft && typeof draft === 'object'
        ? { ...draft, date: null, time: null }
        : draft,
  };
}

@Injectable()
export class ChatPersistenceService {
  private readonly logger = new Logger(ChatPersistenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly bookings: BookingsService,
  ) {}

  /**
   * Load full conversation state from last AiRun signals.
   * Returns bookingDraft, conversationMode, and confirmationPending.
   * Used by chat.service.ts to pass prior state into runAiEngine.
   */
  async loadConversationState(conversationId: string): Promise<ConversationState> {
    const lastRun = await this.prisma.aiRun.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      select: { signals: true },
    });

    if (!lastRun?.signals) {
      return {
        bookingDraft: undefined,
        conversationMode: 'GREETING',
        confirmationPending: false,
        lastIntents: [],
      };
    }

    const signals = lastRun.signals as any;
    const intentsRaw = signals.intents;
    const lastIntents = Array.isArray(intentsRaw)
      ? intentsRaw.map((x: unknown) => String(x))
      : typeof intentsRaw === 'string'
        ? [intentsRaw]
        : [];
    return {
      bookingDraft: signals.bookingDraft as BookingDraft | undefined,
      conversationMode: signals.conversationMode ?? 'GREETING',
      confirmationPending: signals.confirmationPending ?? false,
      lastIntents,
      // Decision Engine v1: load customer signals
      conversationStage: signals.conversationStage,
      customerEmotion: signals.customerEmotion,
      customerResistance: signals.customerResistance,
      customerReadiness: signals.customerReadiness,
      customerTrust: signals.customerTrust,
      customerStyle: signals.customerStyle,
    };
  }

  /**
   * @deprecated Use loadConversationState() instead.
   * Kept for backward compatibility during migration.
   */
  async loadBookingDraft(conversationId: string): Promise<BookingDraft | undefined> {
    const state = await this.loadConversationState(conversationId);
    return state.bookingDraft;
  }

  async saveAiRun(
    tenantId: string,
    conversationId: string,
    result: AiEngineResult,
    execution: SideEffectExecutionResult,
  ): Promise<void> {
    const bookingFailure = execution.failures.find((f) =>
      ['CREATE_BOOKING', 'MODIFY_BOOKING', 'CANCEL_BOOKING'].includes(f.effect.type),
    );
    const status = bookingFailure ? 'ERROR' : 'SUCCESS';
    const error = bookingFailure
      ? `${bookingFailure.effect.type} failed: ${bookingFailure.message}`
      : null;

    const signalsToSave =
      bookingFailure?.effect.type === 'CREATE_BOOKING'
        ? buildPersistedSignals(result.signals, bookingFailure)
        : (result.signals as unknown as Record<string, unknown>);

    await this.prisma.aiRun.create({
      data: {
        tenantId,
        conversationId,
        status,
        model: result.analytics.model,
        inputTokens: result.analytics.inputTokens,
        outputTokens: result.analytics.outputTokens,
        durationMs: result.analytics.durationMs,
        signals: signalsToSave as any,
        sideEffects: execution.succeeded as any,
        sideEffectFailures:
          execution.failures.length > 0
            ? (execution.failures.map((f) => ({
                type: f.effect.type,
                message: f.message,
              })) as any)
            : undefined,
        error,
      },
    });
  }

  async executeSideEffects(
    tenantId: string,
    contactId: string,
    effects: SideEffect[],
    bookingDraft?: BookingDraft,
  ): Promise<SideEffectExecutionResult> {
    const succeeded: SideEffect[] = [];
    const failures: Array<{ effect: SideEffect; message: string }> = [];

    for (const effect of effects) {
      try {
        switch (effect.type) {
          case 'CREATE_BOOKING': {
            const customerName =
              effect.data.customerName ?? bookingDraft?.customerName ?? null;
            const phone = effect.data.phone ?? bookingDraft?.phone ?? null;
            const { created } = await this.bookings.upsertFromAiSideEffect(tenantId, contactId, {
              serviceName: effect.data.serviceName,
              startTime: new Date(effect.data.startTime),
              endTime: effect.data.endTime ? new Date(effect.data.endTime) : undefined,
              notes: effect.data.notes,
              customerName,
              phone,
            });

            if (bookingDraft) {
              await this.contacts.updateFromBookingDraftSafe(tenantId, contactId, {
                customerName,
                phone,
              });
            }

            succeeded.push(effect);
            if (!created) {
              this.logger.log(
                `CREATE_BOOKING idempotent skip (existing row) tenant=${tenantId} contact=${contactId} service=${effect.data.serviceName}`,
              );
            }
            break;
          }

          case 'UPDATE_CONTACT':
            await this.contacts.update(tenantId, contactId, effect.data);
            succeeded.push(effect);
            break;

          case 'MODIFY_BOOKING':
            await this.bookings.modifyBooking(tenantId, effect.bookingId, effect.changes);
            succeeded.push(effect);
            break;

          case 'CANCEL_BOOKING':
            await this.bookings.cancelBooking(tenantId, effect.bookingId);
            succeeded.push(effect);
            break;
        }
      } catch (err) {
        const message = errMsg(err);
        this.logger.error(`Failed to execute side effect: ${effect.type} — ${message}`, err);
        failures.push({ effect, message });
      }
    }

    return { succeeded, failures };
  }

  /**
   * After CREATE/MODIFY/CANCEL booking side effects succeed, clear confirmationPending in
   * conversation.metadata (aligns with packages/api-server post-booking reset).
   * Call after saveAiRun + updateBookingDraft(full) in ChatService.
   */
  async resetConfirmationPendingAfterBookingEffects(
    conversationId: string,
    execution: SideEffectExecutionResult,
  ): Promise<void> {
    const hasBookingMutation = execution.succeeded.some((e) =>
      ['CREATE_BOOKING', 'MODIFY_BOOKING', 'CANCEL_BOOKING'].includes(e.type),
    );
    if (!hasBookingMutation) return;
    try {
      await updateBookingDraft(conversationId, null, false);
    } catch (err) {
      this.logger.warn(
        `Failed to reset confirmationPending after booking side effect: ${errMsg(err)}`,
      );
    }
  }
}

export function verifyChatPersistenceRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const sig: DetectedSignals = {
    intents: ['BOOKING_REQUEST'],
    extractedFields: {},
    action: 'REQUEST_BOOKING',
    bookingDraft: {
      serviceName: 's',
      serviceDisplayName: 'S',
      date: '2026-01-01',
      time: '10:00',
      customerName: 'A',
      phone: '91234567',
    },
  };

  const persisted = buildPersistedSignals(sig, { message: 'db down' }) as any;
  if (persisted._integration?.bookingPersisted !== false) {
    failures.push('expected bookingPersisted false');
  }
  if (persisted.bookingDraft?.date !== null || persisted.bookingDraft?.time !== null) {
    failures.push('expected date/time cleared on booking failure');
  }

  return { ok: failures.length === 0, failures };
}
