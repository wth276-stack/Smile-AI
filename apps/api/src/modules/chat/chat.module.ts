import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { PublicChatController } from './public-chat.controller';
import { ChatService } from './chat.service';
import { KnowledgeRetrieverService } from './knowledge-retriever.service';
import { ChatPersistenceService } from './chat-persistence.service';
import { ContactsModule } from '../contacts/contacts.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { BookingsModule } from '../bookings/bookings.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';

@Module({
  imports: [ContactsModule, ConversationsModule, BookingsModule, KnowledgeBaseModule],
  controllers: [ChatController, PublicChatController],
  providers: [ChatService, KnowledgeRetrieverService, ChatPersistenceService],
})
export class ChatModule {}
