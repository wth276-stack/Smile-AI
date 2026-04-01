import { IsString, IsOptional, IsIn } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  tenantId: string;

  @IsIn(['WEBCHAT', 'WHATSAPP'])
  channel: 'WEBCHAT' | 'WHATSAPP';

  @IsString()
  externalContactId: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsString()
  message: string;
}
