import { prisma } from './client';
import { getBusinessHoursForPrompt } from './business-hours-helpers';

export interface ServiceKnowledgeChunk {
  documentId: string;
  title: string;
  content: string;
  score: number;
  price?: string | null;
  discountPrice?: string | null;
  effect?: string | null;
  suitable?: string | null;
  unsuitable?: string | null;
  precaution?: string | null;
  duration?: string | null;
  aliases?: string[];
  steps?: string[];
  faqItems?: Array<{ question: string; answer: string }> | null;
}

export async function getActiveServicesAsChunks(
  tenantId: string,
): Promise<ServiceKnowledgeChunk[]> {
  const docs = await prisma.knowledgeDocument.findMany({
    where: { tenantId, docType: 'SERVICE', isActive: true },
    orderBy: { title: 'asc' },
  });

  if (docs.length === 0) {
    return [
      {
        documentId: 'no-services',
        title: '服務目錄',
        content: '目前暫無可提供的服務。',
        score: 1.0,
      },
    ];
  }

  return docs.map((d) => ({
    documentId: d.id,
    title: d.title,
    content: d.content,
    score: 1.0,
    price: d.price,
    discountPrice: d.discountPrice,
    effect: d.effect,
    suitable: d.suitable,
    unsuitable: d.unsuitable,
    precaution: d.precaution,
    duration: d.duration,
    aliases: d.aliases,
    steps: d.steps,
    faqItems: d.faqItems as Array<{ question: string; answer: string }> | null,
  }));
}

export async function getKnowledgeChunksFromDB(
  tenantId: string,
): Promise<ServiceKnowledgeChunk[]> {
  const chunks = await getActiveServicesAsChunks(tenantId);

  const hoursText = await getBusinessHoursForPrompt(tenantId);
  chunks.push({
    documentId: 'business-hours',
    title: '營業時間',
    content: hoursText,
    score: 1.0,
  });

  return chunks;
}
