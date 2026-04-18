import {
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

@Controller('whatsapp/webhook')
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(private readonly webhookService: WhatsappWebhookService) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Webhook verified');
      return challenge;
    }

    this.logger.warn('Webhook verification failed');
    throw new ForbiddenException('Invalid verify token');
  }

  @Post()
  handlePost(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): void {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = req.rawBody?.toString() ?? '';

    if (!signature || !this.webhookService.verifySignature(rawBody, signature)) {
      this.logger.warn('Invalid webhook signature');
      res.status(403).json({ error: 'Invalid signature' });
      return;
    }

    res.status(200).json({ status: 'received' });

    this.webhookService.handleIncomingMessage(req.body).catch((err) => {
      this.logger.error(
        `WhatsApp webhook processing failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }
}