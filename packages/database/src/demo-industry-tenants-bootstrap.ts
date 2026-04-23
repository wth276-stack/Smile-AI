import type { PrismaClient } from '@prisma/client';
import { industrySeedData } from './industry-seeds';
import { INDUSTRY_ID_TO_DEMO_TENANT_ID } from './demo-industry-tenants';
import {
  mergeDemoTenantSettingsPreservingKeys,
  tenantJsonMissingStructuredBusinessHours,
} from './demo-tenant-slot-settings';

/**
 * Idempotent: each demo industry tenant gets structured businessHours + timezone from its seed
 * when missing (same self-heal idea as ensureDemoTenantStructuredSlotSettings for legacy demo-tenant).
 */
export async function ensureDemoIndustryTenantsStructuredSlotSettings(
  prisma: PrismaClient,
): Promise<void> {
  for (const [industryId, tenantId] of Object.entries(INDUSTRY_ID_TO_DEMO_TENANT_ID)) {
    const seed = industrySeedData[industryId];
    if (!seed?.businessHours) continue;

    const row = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    if (!row) continue;

    const existing = (row.settings as Record<string, unknown>) ?? {};
    if (!tenantJsonMissingStructuredBusinessHours(existing)) continue;

    const merged = mergeDemoTenantSettingsPreservingKeys(existing, {
      businessHours: seed.businessHours,
      timezone: seed.timezone ?? 'Asia/Hong_Kong',
    });
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: merged as object },
    });
    console.warn(
      `[demo-industry] Patched ${tenantId} (${industryId}): structured businessHours + timezone`,
    );
  }
}
