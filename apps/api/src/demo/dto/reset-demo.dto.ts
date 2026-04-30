import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class ResetDemoDto {
  @IsString()
  industryId!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  /**
   * Destructive opt-in. Default reset preserves KnowledgeDocument rows so the
   * sales demo KB cannot be wiped by a routine UI/demo reset.
   */
  @IsOptional()
  @IsBoolean()
  resetKnowledgeBase?: boolean;
}
