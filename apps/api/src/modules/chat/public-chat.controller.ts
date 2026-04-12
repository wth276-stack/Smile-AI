import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ChatService } from './chat.service';
import { PublicChatDto } from './dto/public-chat.dto';

@Controller('chat')
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60000 } })
export class PublicChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('public')
  handlePublic(@Body() dto: PublicChatDto) {
    return this.chat.handlePublicMessage(dto);
  }
}
