import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ChatModule } from '../chat/chat.module';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';
import { WhatsappWebhookService } from './whatsapp-webhook.service';
import { WhatsappSenderService } from './whatsapp-sender.service';

@Module({
  imports: [ConfigModule, ChatModule, PrismaModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappWebhookService, WhatsappSenderService],
})
export class WhatsappModule {}