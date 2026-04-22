import type { PrismaClient } from '@prisma/client';

export const DEMO_TENANT_ID = 'demo-tenant';

/** Canonical structured hours for demo-tenant slot gate (beauty / default demo). */
export const DEMO_TENANT_CANONICAL_SLOT_SETTINGS = {
  timezone: 'Asia/Hong_Kong',
  businessHours: {
    mon: '10:00-21:00',
    tue: '10:00-21:00',
    wed: '10:00-21:00',
    thu: '10:00-21:00',
    fri: '10:00-21:00',
    sat: '10:00-19:00',
    sun: 'closed',
  },
} as const;

const WEEKDAY_KEYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

/** True if settings lack usable weekly businessHours for the slot gate (same idea as parseBusinessHoursToWeekly hasAny). */
export function tenantJsonMissingStructuredBusinessHours(settings: unknown): boolean {
  const s = settings as Record<string, unknown> | null | undefined;
  const businessHours = s?.businessHours;
  if (!businessHours || typeof businessHours !== 'object') return true;
  const obj = businessHours as Record<string, unknown>;
  for (const [k0, v] of Object.entries(obj)) {
    const k = k0.toLowerCase().replace(/\s/g, '');
    if (!WEEKDAY_KEYS.has(k)) continue;
    if (v === 'closed' || v === 'CLOSED' || v === 'rest' || v === '休息' || v === 'none') {
      return false;
    }
    if (typeof v === 'string' && v.trim()) {
      const compact = v.replace(/\s+/g, '');
      if (/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(compact)) return false;
    }
    if (v && typeof v === 'object' && 'open' in (v as object) && 'close' in (v as object)) {
      const o = v as { open: string; close: string };
      if (typeof o.open === 'string' && typeof o.close === 'string') {
        const compact = `${o.open}-${o.close}`.replace(/\s+/g, '');
        if (/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(compact)) return false;
      }
    }
  }
  return true;
}

export function mergeDemoTenantSettingsPreservingKeys(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...patch };
}

export type EnsureDemoTenantSlotSettingsResult = {
  tenantFound: boolean;
  patched: boolean;
  hasBusinessHours: boolean;
  timezone: string;
};

/**
 * Idempotent: merges canonical businessHours + timezone into demo-tenant.settings only when
 * structured businessHours are missing. Never removes unrelated keys.
 */
export async function ensureDemoTenantStructuredSlotSettings(
  prisma: PrismaClient,
): Promise<EnsureDemoTenantSlotSettingsResult> {
  const row = await prisma.tenant.findUnique({
    where: { id: DEMO_TENANT_ID },
    select: { settings: true },
  });

  if (!row) {
    console.warn(`[demo-tenant] ensureDemoTenantStructuredSlotSettings: tenant ${DEMO_TENANT_ID} not found, skip`);
    return {
      tenantFound: false,
      patched: false,
      hasBusinessHours: false,
      timezone: DEMO_TENANT_CANONICAL_SLOT_SETTINGS.timezone,
    };
  }

  const existing = (row.settings as Record<string, unknown>) ?? {};
  const missing = tenantJsonMissingStructuredBusinessHours(existing);
  let patched = false;
  let merged = existing;

  if (missing) {
    merged = mergeDemoTenantSettingsPreservingKeys(existing, {
      ...DEMO_TENANT_CANONICAL_SLOT_SETTINGS,
    });
    await prisma.tenant.update({
      where: { id: DEMO_TENANT_ID },
      data: { settings: merged as object },
    });
    patched = true;
    console.warn(
      `[demo-tenant] Patched Tenant.settings: added structured businessHours + timezone (idempotent self-heal)`,
    );
  }

  const hasBusinessHours = !tenantJsonMissingStructuredBusinessHours(merged);
  const tz =
    typeof merged.timezone === 'string' && merged.timezone.trim()
      ? merged.timezone.trim()
      : DEMO_TENANT_CANONICAL_SLOT_SETTINGS.timezone;

  console.warn(`[SlotGate] tenant=${DEMO_TENANT_ID} hasBusinessHours=${hasBusinessHours} timezone=${tz}`);

  return { tenantFound: true, patched, hasBusinessHours, timezone: tz };
}
