import { IsString, IsOptional } from 'class-validator';

/**
 * DTO for public demo chat endpoint (no authentication required)
 * Used by the Smile AI Landing Page demo
 */
export class DemoChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  industry?: string; // beauty, cleaning, renovation, consulting, yoga
}