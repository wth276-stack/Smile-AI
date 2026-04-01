import { extractServiceText } from './service-matcher';
import type { SlotExtraction } from './booking-state';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeLiteral(text: string, value: string | null): string {
  if (!value) return text;
  const trimmed = value.trim();
  if (!trimmed) return text;
  return text.replace(new RegExp(escapeRegExp(trimmed), 'gi'), ' ');
}

function stripIdentityBoilerplate(text: string): string {
  return text
    .replace(/我(叫|係|是|姓)\s*/g, '')
    .replace(/(?:name|名)\s*(?:is|係|:)\s*/gi, '')
    .replace(/(?:電話|手機|whatsapp|whats\s*app|聯絡|聯繫|contact|tel\.?|mobile)\s*/gi, '')
    .replace(/\d{8,11}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasServiceCue(text: string): boolean {
  return /療程|服務|facial|treatment|laser|hifu|service|product|項目|booking|預約/i.test(text);
}

export function extractServiceCandidate(
  message: string,
  slots?: Partial<SlotExtraction>,
): string {
  let candidate = extractServiceText(message);
  candidate = removeLiteral(candidate, slots?.customerName ?? null);
  candidate = removeLiteral(candidate, slots?.phone ?? null);
  candidate = stripIdentityBoilerplate(candidate);

  if ((slots?.customerName || slots?.phone) && !hasServiceCue(candidate) && candidate.length < 2) {
    return '';
  }

  return candidate;
}
