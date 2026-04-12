import { Controller, Post, Body } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { DemoChatDto } from './dto/demo-chat.dto';

@Controller('chat')
export class ChatController {
  @Post('message')
  handleMessage(@Body() dto: ChatMessageDto) {
    return this.chat.handleInboundMessage(dto);
  }

  /**
   * Public demo endpoint for Landing Page
   * No authentication required - uses demo-tenant
   */
  @Post('demo')
  handleDemoMessage(@Body() dto: DemoChatDto) {
    // Generate a unique contact ID for each demo session
    const sessionId = `demo-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    return this.chat.handleInboundMessage({
      tenantId: 'demo-tenant',
      channel: 'WEBCHAT',
      externalContactId: sessionId,
      contactName: 'Demo User',
      message: dto.message,
    });
  }

  constructor(private readonly chat: ChatService) {}
}
