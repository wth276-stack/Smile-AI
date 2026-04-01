import { Module } from '@nestjs/common';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KbImportService } from './kb-import.service';

@Module({
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, KbImportService],
  exports: [KnowledgeBaseService, KbImportService],
})
export class KnowledgeBaseModule {}
