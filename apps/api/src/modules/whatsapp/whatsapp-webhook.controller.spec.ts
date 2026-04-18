import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappWebhookService } from './whatsapp-webhook.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChatService } from '../chat/chat.service';
import { WhatsappSenderService } from './whatsapp-sender.service';

describe('WhatsappWebhookController', () => {
  let controller: WhatsappWebhookController;

  const mockWebhookService = {
    verifySignature: jest.fn(),
    handleIncomingMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappWebhookController],
      providers: [
        { provide: WhatsappWebhookService, useValue: mockWebhookService },
      ],
    }).compile();

    controller = module.get(WhatsappWebhookController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('verifyWebhook', () => {
    const originalVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    beforeAll(() => {
      process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
    });

    afterAll(() => {
      process.env.WHATSAPP_VERIFY_TOKEN = originalVerifyToken;
    });

    it('returns challenge on valid verification', () => {
      const result = controller.verifyWebhook(
        'subscribe',
        'test-verify-token',
        'challenge123',
      );
      expect(result).toBe('challenge123');
    });

    it('throws ForbiddenException on invalid verify token', () => {
      expect(() =>
        controller.verifyWebhook('subscribe', 'wrong-token', 'challenge123'),
      ).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException on invalid mode', () => {
      expect(() =>
        controller.verifyWebhook('unsubscribe', 'test-verify-token', 'challenge123'),
      ).toThrow(ForbiddenException);
    });
  });
});

describe('WhatsappWebhookService', () => {
  let service: WhatsappWebhookService;
  let prisma: { channelConfig: { findFirst: jest.Mock } };
  let chatService: { handleInboundMessage: jest.Mock };
  let sender: { sendTextMessage: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      channelConfig: {
        findFirst: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          credentials: {
            phone_number_id: '123456',
            access_token: 'test-token',
          },
        }),
      },
    };

    chatService = {
      handleInboundMessage: jest.fn(),
    };

    sender = {
      sendTextMessage: jest.fn(),
    };

    configService = {
      get: jest.fn().mockReturnValue('test-app-secret'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappWebhookService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChatService, useValue: chatService },
        { provide: WhatsappSenderService, useValue: sender },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(WhatsappWebhookService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('verifySignature', () => {
    it('rejects when WHATSAPP_APP_SECRET is not set', () => {
      configService.get.mockReturnValue(undefined);
      expect(service.verifySignature('payload', 'sha256=some')).toBe(false);
    });

    it('rejects when signature header is missing', () => {
      expect(service.verifySignature('payload', undefined)).toBe(false);
    });

    it('accepts a valid HMAC-SHA256 signature', () => {
      configService.get.mockReturnValue('test-app-secret');
      const crypto = require('crypto');
      const expectedSig = `sha256=${crypto
        .createHmac('sha256', 'test-app-secret')
        .update('test-payload')
        .digest('hex')}`;

      expect(service.verifySignature('test-payload', expectedSig)).toBe(true);
    });

    it('rejects an invalid signature', () => {
      configService.get.mockReturnValue('test-app-secret');
      expect(service.verifySignature('test-payload', 'sha256=badsignature')).toBe(
        false,
      );
    });
  });

  describe('handleIncomingMessage', () => {
    it('ignores non-WhatsApp events', async () => {
      await service.handleIncomingMessage({ object: 'page' });
      expect(chatService.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('ignores non-messages fields', async () => {
      await service.handleIncomingMessage({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field: 'message_echoes', value: {} }] }],
      });

      expect(chatService.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('processes a valid text message and sends reply', async () => {
      chatService.handleInboundMessage.mockResolvedValue({
        reply: 'Hello! How can I help?',
        conversationId: 'conv-1',
      });

      await service.handleIncomingMessage({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '16505551111',
                    phone_number_id: '123456',
                  },
                  contacts: [
                    {
                      profile: { name: 'Test User' },
                      wa_id: '16315551181',
                    },
                  ],
                  messages: [
                    {
                      id: 'msg-1',
                      from: '16315551181',
                      type: 'text',
                      text: { body: 'Hi' },
                      timestamp: '1504902988',
                    },
                  ],
                },
              },
            ],
          },
        ],
      });

      expect(chatService.handleInboundMessage).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        channel: 'WHATSAPP',
        externalContactId: '16315551181',
        contactName: 'Test User',
        message: 'Hi',
      });

      expect(sender.sendTextMessage).toHaveBeenCalledWith(
        'test-token',
        '123456',
        '16315551181',
        'Hello! How can I help?',
      );
    });

    it('skips duplicate messages', async () => {
      chatService.handleInboundMessage.mockResolvedValue({ reply: 'Hi' });

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '16505551111',
                    phone_number_id: '123456',
                  },
                  contacts: [
                    {
                      profile: { name: 'Test' },
                      wa_id: '16315551181',
                    },
                  ],
                  messages: [
                    {
                      id: 'msg-dup',
                      from: '16315551181',
                      type: 'text',
                      text: { body: 'Hi' },
                      timestamp: '1504902988',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await service.handleIncomingMessage(payload);
      await service.handleIncomingMessage(payload);

      expect(chatService.handleInboundMessage).toHaveBeenCalledTimes(1);
    });

    it('skips non-text messages', async () => {
      await service.handleIncomingMessage({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '16505551111',
                    phone_number_id: '123456',
                  },
                  contacts: [
                    {
                      profile: { name: 'Test' },
                      wa_id: '16315551181',
                    },
                  ],
                  messages: [
                    {
                      id: 'msg-img',
                      from: '16315551181',
                      type: 'image',
                      timestamp: '1504902988',
                    },
                  ],
                },
              },
            ],
          },
        ],
      });

      expect(chatService.handleInboundMessage).not.toHaveBeenCalled();
    });

    it('logs status events without processing', async () => {
      await service.handleIncomingMessage({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '16505551111',
                    phone_number_id: '123456',
                  },
                  statuses: [{ id: 'wamid-1', status: 'delivered' }],
                },
              },
            ],
          },
        ],
      });

      expect(chatService.handleInboundMessage).not.toHaveBeenCalled();
    });
  });
});