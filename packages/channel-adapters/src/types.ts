import type { ChannelType, MessageContentType } from '@ats/shared';

export interface IncomingMessage {
  channel: ChannelType;
  externalContactId: string;
  externalConversationId: string;
  contentType: MessageContentType;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface OutgoingMessage {
  channel: ChannelType;
  externalContactId: string;
  externalConversationId: string;
  content: string;
  contentType?: MessageContentType;
  metadata?: Record<string, unknown>;
}

export interface ChannelAdapter {
  readonly channel: ChannelType;
  sendMessage(msg: OutgoingMessage): Promise<void>;
  parseWebhook(payload: unknown): IncomingMessage;
  verifyWebhook(payload: unknown, signature?: string): boolean;
}
