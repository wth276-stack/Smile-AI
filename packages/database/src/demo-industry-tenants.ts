/**
 * Maps each switchable industry demo to a dedicated tenant row so conversations,
 * KB, and services stay tenant-scoped (no cross-demo leakage).
 * Beauty keeps legacy id `demo-tenant` for backward compatibility with existing seeds and scripts.
 */
export const INDUSTRY_ID_TO_DEMO_TENANT_ID: Record<string, string> = {
  beauty: 'demo-tenant',
  cleaning: 'demo-tenant-cleaning',
  yoga: 'demo-tenant-yoga',
  consulting: 'demo-tenant-consulting',
  renovation: 'demo-tenant-renovation',
};

export const ALL_DEMO_INDUSTRY_TENANT_IDS: readonly string[] = [
  ...new Set(Object.values(INDUSTRY_ID_TO_DEMO_TENANT_ID)),
];

const tenantIdToIndustry = new Map<string, string>(
  Object.entries(INDUSTRY_ID_TO_DEMO_TENANT_ID).map(([k, v]) => [v, k]),
);

export function getDemoTenantIdForIndustryId(industryId: string): string | undefined {
  return INDUSTRY_ID_TO_DEMO_TENANT_ID[industryId.trim()];
}

export function getIndustryIdForDemoTenantId(tenantId: string): string | undefined {
  return tenantIdToIndustry.get(tenantId);
}

export function isDemoIndustryTenantId(tenantId: string): boolean {
  return tenantIdToIndustry.has(tenantId);
}

/** For V2 prompt tenant.settings.businessType — generic labels, not industry-specific branching. */
export function mapIndustryIdToBusinessType(industryId: string): string {
  const m: Record<string, string> = {
    beauty: 'beauty salon',
    cleaning: 'professional cleaning service',
    renovation: 'renovation and interior design',
    consulting: 'private consulting',
    yoga: 'yoga and fitness studio',
  };
  return m[industryId] ?? 'general business';
}
