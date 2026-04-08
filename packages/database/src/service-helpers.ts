import { getBusinessHoursForPrompt } from './business-hours-helpers';
import { getActiveServices, type ActiveServiceKnowledgeChunk } from './v2-helpers';

export type ServiceKnowledgeChunk = ActiveServiceKnowledgeChunk;

export async function getActiveServicesAsChunks(
  tenantId: string,
): Promise<ServiceKnowledgeChunk[]> {
  const services = await getActiveServices(tenantId);

  if (services.length === 0) {
    return [
      {
        documentId: 'no-services',
        title: '服務目錄',
        content: '目前暫無可提供的服務。',
        score: 1.0,
        price: null,
        discountPrice: null,
        effect: null,
        suitable: null,
        unsuitable: null,
        precaution: null,
        duration: null,
        aliases: [],
        steps: [],
        faqItems: null,
      },
    ];
  }

  return services;
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
    price: null,
    discountPrice: null,
    effect: null,
    suitable: null,
    unsuitable: null,
    precaution: null,
    duration: null,
    aliases: [],
    steps: [],
    faqItems: null,
  });

  return chunks;
}
