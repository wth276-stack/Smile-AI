import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChatService } from '../chat/chat.service';
import { WhatsappSenderService } from './whatsapp-sender.service';

interface WhatsAppMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  timestamp?: string;
}

interface WhatsAppContact {
  profile?: { name?: string };
  wa_id: string;
}

interface WhatsAppStatus {
  id: string;
  status: string;
  [key: string]: unknown;
}

interface WhatsAppValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

interface WhatsAppChange {
  field?: string;
  value?: WhatsAppValue;
}

interface WhatsAppEntry {
  id?: string;
  changes?: WhatsAppChange[];
}

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: WhatsAppEntry[];
}

@Injectable()
export class WhatsappWebhookService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsappWebhookService.name);
  private readonly processedMessageIds = new Map<string, number>();
  private readonly idempotencyTtlMs = 5 * 60 * 1000;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly sender: WhatsappSenderService,
    private readonly configService: ConfigService,
  ) {
    this.cleanupTimer = setInterval(
      () => this.cleanupProcessedIds(),
      this.idempotencyTtlMs,
    );
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  verifySignature(payload: string | Buffer, signature?: string): boolean {
    const appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET');

    if (!appSecret) {
      this.logger.error(
        'WHATSAPP_APP_SECRET not set; rejecting webhook signature verification',
      );
      return false;
    }

    if (!signature) {
      this.logger.warn('Missing X-Hub-Signature-256 header');
      return false;
    }

    const expectedSig = `sha256=${createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex')}`;

    try {
      return timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSig, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  async handleIncomingMessage(rawPayload: unknown): Promise<void> {
    const payload = rawPayload as WhatsAppWebhookPayload;

    if (payload.object !== 'whatsapp_business_account') {
      this.logger.debug('Ignoring non-WhatsApp webhook event');
      return;
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') {
          this.logger.debug(`Ignoring webhook field: ${change.field}`);
          continue;
        }

        if (!change.value) {
          this.logger.debug('Ignoring messages change with empty value');
          continue;
        }

        await this.handleMessagesValue(change.value);
      }
    }
  }

  private async handleMessagesValue(value: WhatsAppValue): Promise<void> {
    const phoneNumberId = value.metadata?.phone_number_id;

    if (!phoneNumberId) {
      this.logger.warn('No phone_number_id in webhook payload');
      return;
    }

    const channelConfig = await this.prisma.channelConfig.findFirst({
      where: {
        channel: 'WHATSAPP',
        isActive: true,
        OR: [
          { credentials: { path: ['phone_number_id'], equals: phoneNumberId } },
          { credentials: { path: ['phoneNumberId'], equals: phoneNumberId } },
        ],
      },
    });

    if (!channelConfig) {
      this.logger.warn(
        `No active WhatsApp ChannelConfig for phone_number_id: ${phoneNumberId}`,
      );
      return;
    }

    const tenantId = channelConfig.tenantId;
    const credentials =
      (channelConfig.credentials as Record<string, unknown> | null) ?? {};
    const accessToken =
      typeof credentials.access_token === 'string'
        ? credentials.access_token
        : null;

    if (!accessToken) {
      this.logger.error(
        `No access_token in ChannelConfig for tenant ${tenantId}`,
      );
      return;
    }

    for (const status of value.statuses ?? []) {
      this.logger.log(`Message ${status.id} status: ${status.status}`);
    }

    const contacts = value.contacts ?? [];

    for (const msg of value.messages ?? []) {
      if (!msg.id) {
        this.logger.debug('Skipping WhatsApp message with no id');
        continue;
      }

      if (this.isDuplicate(msg.id)) {
        this.logger.debug(`Skipping duplicate WhatsApp message: ${msg.id}`);
        continue;
      }

      this.markProcessed(msg.id);

      try {
        if (msg.type !== 'text') {
          this.logger.debug(`Skipping non-text message type: ${msg.type}`);
          continue;
        }

        const text = msg.text?.body?.trim();
        if (!text) {
          this.logger.debug('Skipping message with empty text body');
          continue;
        }

        const waId = msg.from;
        if (!waId) {
          this.logger.debug(`Skipping message ${msg.id} with no sender wa_id`);
          continue;
        }

        const contact = contacts.find((c) => c.wa_id === waId);
        const contactName = contact?.profile?.name;

        const result = await this.chatService.handleInboundMessage({
          tenantId,
          channel: 'WHATSAPP',
          externalContactId: waId,
          contactName,
          message: text,
        });

        if (result.reply?.trim()) {
          await this.sender.sendTextMessage(
            accessToken,
            phoneNumberId,
            waId,
            result.reply,
          );
        }
      } catch (err) {
        this.logger.error(
          `Error processing WhatsApp message ${msg.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        this.unmarkProcessed(msg.id);
      }
    }
  }

  private isDuplicate(messageId: string): boolean {
    return this.processedMessageIds.has(messageId);
  }

  private markProcessed(messageId: string): void {
    this.processedMessageIds.set(messageId, Date.now());
  }

  private unmarkProcessed(messageId: string): void {
    this.processedMessageIds.delete(messageId);
  }

  private cleanupProcessedIds(): void {
    const now = Date.now();

    for (const [id, timestamp] of this.processedMessageIds.entries()) {
      if (now - timestamp > this.idempotencyTtlMs) {
        this.processedMessageIds.delete(id);
      }
    }
  }
}