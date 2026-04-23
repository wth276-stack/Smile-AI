import { IsOptional, IsString } from 'class-validator';

export class RebindWhatsappDemoDto {
  @IsString()
  industryId!: string;

  /** Optional: specific ChannelConfig id; default = most recently updated active WHATSAPP row */
  @IsOptional()
  @IsString()
  channelConfigId?: string;
}
