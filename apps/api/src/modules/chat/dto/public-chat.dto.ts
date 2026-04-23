import { IsOptional, IsString, MinLength } from 'class-validator';

export class PublicChatDto {
  /**
   * Tenant id (Prisma tenant id). Required unless `industryId` is provided.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  tenantSlug?: string;

  /**
   * Demo industry id: beauty | cleaning | yoga | consulting | renovation.
   * When set, selects the corresponding demo tenant (takes precedence over tenantSlug).
   */
  @IsOptional()
  @IsString()
  industryId?: string;

  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}
