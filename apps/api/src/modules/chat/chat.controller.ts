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
   * Debug / legacy demo route — delegates to the same public webchat path as the landing
   * widget so conversationId + industry work consistently (enginePath in responses when
   * contact is a demo user contact name is handled by isDemoChat).
   */
  @Post('demo')
  handleDemoMessage(@Body() dto: DemoChatDto) {
    return this.chat.handlePublicMessage({
      industryId: (dto.industry ?? 'beauty').trim(),
      message: dto.message,
      conversationId: dto.conversationId,
    });
  }

  constructor(private readonly chat: ChatService) {}
}
