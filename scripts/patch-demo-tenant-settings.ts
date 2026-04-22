/**
 * Manual: patch demo-tenant.settings with structured businessHours if missing.
 *
 *   pnpm exec tsx scripts/patch-demo-tenant-settings.ts
 *
 * Requires DATABASE_URL. Idempotent; does not remove other settings keys.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { ensureDemoTenantStructuredSlotSettings } from '../packages/database/src/demo-tenant-slot-settings';

config({ path: resolve(process.cwd(), '.env') });

const prisma = new PrismaClient();

async function main() {
  const r = await ensureDemoTenantStructuredSlotSettings(prisma);
  console.log(JSON.stringify({ ok: true, ...r }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
