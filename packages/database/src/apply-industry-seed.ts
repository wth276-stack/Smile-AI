import type { PrismaClient } from '@prisma/client';
import { DocType } from '@prisma/client';
import { getIndustrySeed, type IndustryService } from './industry-seeds';
import { mergeDemoTenantSettingsPreservingKeys } from './demo-tenant-slot-settings';
import { mapIndustryIdToBusinessType } from './demo-industry-tenants';

function buildServiceKbContent(svc: IndustryService): string {
  const faqLine = svc.faq.map((f) => `${f.q}: ${f.a}`).join(' / ');
  return `## ${svc.displayName}\n價錢: ${svc.price} | 時間: ${svc.duration}\n功效: ${svc.description}\n適合: ${svc.suitable}\n注意: ${svc.caution}\n常見問題: ${faqLine}`;
}

/**
 * Replace all KB documents and sync tenant name / settings from an industry seed.
 * Used by demo reset and database seed scripts.
 */
export async function applyIndustrySeedToTenant(
  prisma: PrismaClient,
  tenantId: string,
  industryId: string,
): Promise<{ servicesCount: number; kbCount: number; displayName: string }> {
  const seed = getIndustrySeed(industryId.trim());
  if (!seed) {
    throw new Error(`Unknown industryId: ${industryId}`);
  }

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
  });

  const existingSettings = (tenant.settings as Record<string, unknown>) ?? {};

  let mergedSettings = mergeDemoTenantSettingsPreservingKeys(existingSettings, {
    businessName: seed.displayName,
    assistantRole: seed.persona,
    businessHoursText: seed.businessHoursText,
    contactPhone: seed.contactPhone,
    contactWhatsApp: seed.contactWhatsApp,
    businessType: mapIndustryIdToBusinessType(seed.id),
  });
  if (seed.businessHours) {
    mergedSettings = mergeDemoTenantSettingsPreservingKeys(mergedSettings, {
      businessHours: seed.businessHours,
      timezone: seed.timezone ?? 'Asia/Hong_Kong',
    });
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: seed.displayName,
      settings: mergedSettings as object,
    },
  });

  await prisma.knowledgeDocument.deleteMany({
    where: { tenantId },
  });

  let kbCount = 0;

  for (const kb of seed.knowledgeBase) {
    await prisma.knowledgeDocument.create({
      data: {
        tenantId,
        title: kb.title,
        content: kb.content,
        docType: DocType.FAQ,
        isActive: true,
      },
    });
    kbCount += 1;
  }

  for (const svc of seed.services) {
    const content = buildServiceKbContent(svc);
    await prisma.knowledgeDocument.create({
      data: {
        tenantId,
        title: svc.displayName,
        content,
        docType: DocType.SERVICE,
        isActive: true,
        duration: svc.duration,
        effect: svc.description,
        suitable: svc.suitable,
        unsuitable: undefined,
        precaution: svc.caution,
        price: svc.price,
        aliases: [
          svc.name,
          svc.displayName,
          ...(svc.extraAliases ?? []),
        ],
        faqItems: svc.faq.map((f) => ({ question: f.q, answer: f.a })),
      },
    });
    kbCount += 1;
  }

  return {
    servicesCount: seed.services.length,
    kbCount,
    displayName: seed.displayName,
  };
}
