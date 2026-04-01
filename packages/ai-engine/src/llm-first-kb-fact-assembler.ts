import type { KBFactBundle, KnowledgeChunk } from './types';
import { buildServiceCatalog, matchService } from './service-matcher';
import { buildFaqCatalog, matchFaq } from './faq-matcher';

function extractExactPrice(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(?:HKD|\$)\s*\d+/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

function extractSalonInfo(knowledge: KnowledgeChunk[]): {
  address: string | null;
  hours: string | null;
  location: string | null;
} {
  const joined = knowledge.map((k) => `${k.title}\n${k.content}`).join('\n');
  const lines = joined.split('\n').map((l) => l.trim()).filter(Boolean);
  const pick = (re: RegExp) => lines.find((l) => re.test(l)) ?? null;
  return {
    address: pick(/地址|address|地[址點]|location/i),
    hours: pick(/營業時間|opening|business.?hours?|幾點開|幾點關/i),
    location: pick(/喺邊|在哪|where|分店|branch|地點/i),
  };
}

export function assembleKbFactBundle(
  knowledge: KnowledgeChunk[],
  userMessage: string,
  serviceFocus: string | null,
): KBFactBundle {
  const catalog = buildServiceCatalog(knowledge);
  const whitelist = catalog.map((s) => s.displayName);
  const serviceAliasLookup: Record<string, string> = {};
  for (const svc of catalog) {
    serviceAliasLookup[svc.displayName.toLowerCase()] = svc.displayName;
    for (const alias of svc.aliases) {
      serviceAliasLookup[alias.toLowerCase()] = svc.displayName;
    }
  }

  const focusMatch = serviceFocus ? matchService(serviceFocus, catalog) : { type: 'none', matches: [] as any[] };
  const focusService =
    focusMatch.type === 'exact' || focusMatch.type === 'close'
      ? focusMatch.matches[0]?.service ?? null
      : null;

  const faqCatalog = buildFaqCatalog(knowledge);
  const faqMatch = matchFaq(userMessage, faqCatalog, {
    minConfidence: 0.45,
    preferServiceContext: focusService?.displayName ?? null,
  });
  const faqMatches =
    faqMatch.type === 'matched' && faqMatch.match
      ? [
          {
            id: faqMatch.match.sourceId,
            question: faqMatch.match.question,
            answer: faqMatch.match.answer,
            confidence: faqMatch.match.confidence,
          },
        ]
      : [];

  const exactPrice = extractExactPrice(focusService?.price ?? focusService?.priceInfo);
  const salonInfo = extractSalonInfo(knowledge);
  const summary = [
    focusService ? `ServiceFocus: ${focusService.displayName}` : 'ServiceFocus: none',
    exactPrice ? `Price: ${exactPrice}` : 'Price: unknown',
    salonInfo.address ? `SalonAddress: ${salonInfo.address}` : 'SalonAddress: unknown',
    salonInfo.hours ? `SalonHours: ${salonInfo.hours}` : 'SalonHours: unknown',
    faqMatches.length > 0 ? `FAQ: ${faqMatches[0].question}` : 'FAQ: none',
  ].join('\n');

  return {
    serviceFocus: focusService,
    serviceWhitelist: whitelist,
    serviceAliasLookup,
    exactPrice,
    salonInfo,
    faqMatches,
    noData: !focusService && faqMatches.length === 0,
    summary,
  };
}

