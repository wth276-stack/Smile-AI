import { IsOptional, IsString } from 'class-validator';

export class ResetDemoDto {
  @IsString()
  industryId!: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}
