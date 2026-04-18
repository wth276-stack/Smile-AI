import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappSenderService {
  private readonly logger = new Logger(WhatsappSenderService.name);
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = this.configService.get<string>(
      'WHATSAPP_API_URL',
      'https://graph.facebook.com/v25.0',
    );
  }

  async sendTextMessage(
    accessToken: string,
    phoneNumberId: string,
    recipientWaId: string,
    text: string,
  ): Promise<void> {
    const url = `${this.apiUrl}/${phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientWaId,
          type: 'text',
          text: { body: text },
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(`WhatsApp send failed (${response.status}): ${body}`);
        throw new Error(`WhatsApp API error: ${response.status}`);
      }
    } catch (err) {
      this.logger.error(
        `Failed to send WhatsApp message: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}