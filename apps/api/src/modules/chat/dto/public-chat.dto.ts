import { IsOptional, IsString, MinLength } from 'class-validator';

export class PublicChatDto {
  @IsString()
  @MinLength(1)
  tenantSlug!: string;

  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}
