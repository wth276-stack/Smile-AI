import { IsString, IsOptional, MinLength } from 'class-validator';

/**
 * Same behavior as POST /api/chat/public with `industryId` + `conversationId`.
 * Contact name is "Website Visitor" in the engine (via handlePublicMessage); isDemoChat
 * still true for all industry demo tenants so enginePath / fallbackReason are included.
 * For multi-turn, pass `conversationId` from the previous response.
 */
export class DemoChatDto {
  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsString()
  industry?: string; // beauty, cleaning, renovation, consulting, yoga

  @IsOptional()
  @IsString()
  conversationId?: string;
}