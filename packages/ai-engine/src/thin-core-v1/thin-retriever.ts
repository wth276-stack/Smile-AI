import type { KnowledgeChunk } from '../types';

export interface ThinEntityRef {
  documentId: string;
  title: string;
  /** Concatenated price-related text from KB for validator checks */
  priceFingerprint: string;
}

export interface ThinRetrievalResult {
  /** Flat text for the LLM (truncated) */
  contextText: string;
  /** Valid matchedEntityId targets */
  entities: ThinEntityRef[];
  /** documentId → chunk */
  entityById: Map<string, KnowledgeChunk>;
}

const MAX_CHARS = 12000;
const PER_CHUNK = 2800;

/**
 * Formats KB chunks for one LLM context block. No heuristic intent routing — caller passes API-retrieved knowledge.
 */
export function thinFormatKnowledgeContext(chunks: KnowledgeChunk[]): ThinRetrievalResult {
  const entityById = new Map<string, KnowledgeChunk>();
  const entities: ThinEntityRef[] = [];

  const parts: string[] = [];
  let used = 0;

  for (const ch of chunks) {
    entityById.set(ch.documentId, ch);
    const priceBits = [ch.price, ch.discountPrice].filter(Boolean).join(' | ');
    entities.push({
      documentId: ch.documentId,
      title: ch.title,
      priceFingerprint: priceBits,
    });

    const block = [
      `[documentId=${ch.documentId}]`,
      `title=${ch.title}`,
      ch.content.slice(0, PER_CHUNK),
      ch.effect ? `effect=${ch.effect}` : '',
      ch.suitable ? `suitable=${ch.suitable}` : '',
      ch.unsuitable ? `unsuitable=${ch.unsuitable}` : '',
      ch.precaution ? `precaution=${ch.precaution}` : '',
      ch.duration ? `duration=${ch.duration}` : '',
      ch.price ? `price=${ch.price}` : '',
      ch.discountPrice ? `discountPrice=${ch.discountPrice}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (used + block.length > MAX_CHARS) break;
    parts.push(block);
    used += block.length;
  }

  const contextText =
    parts.length > 0
      ? parts.join('\n\n---\n\n')
      : '(No knowledge chunks retrieved for this turn. Answer from general salon-safe guidance only; do not invent prices or service facts.)';

  return { contextText, entities, entityById };
}
