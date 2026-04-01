import { Controller, Post, Body } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@Controller('chat')
export class ChatController {
  @Post('message')
  handleMessage(@Body() dto: ChatMessageDto) {
    return this.chat.handleInboundMessage(dto);
  }

  constructor(private readonly chat: ChatService) {}
}
