/**
 * Ensures Phase 2A demo tenants (cleaning + yoga shell + Canonical KB seed) exist.
 * Does NOT create or mutate `demo-tenant` / beauty KB (protected demo).
 *
 * Before any destructive KB re-seed (`applyIndustrySeedToTenant`), writes a timestamped backup
 * under `artifacts/kb-backups/` via `backupTenantKbToArtifacts`.
 *
 * Run after migrate or when /api/chat/public returns 404 for cleaning|yoga.
 *
 *   pnpm run demo:ensure:phase2a
 *
 * PowerShell: chain with `;` not `&&` (PS 5.x).
 */
import { config } from 'dotenv';
import { resolve } from 'path';

import {
  prisma,
  getDemoTenantIdForIndustryId,
  applyIndustrySeedToTenant,
} from '../packages/database/src/index';
import { backupTenantKbToArtifacts } from './kb-backup-artifacts';

config({ path: resolve(process.cwd(), '.env') });

const REPO_ROOT = process.cwd();
const PHASE_INDUSTRIES = ['cleaning', 'yoga'] as const;

async function main() {
  for (const industryId of PHASE_INDUSTRIES) {
    const tenantId = getDemoTenantIdForIndustryId(industryId);
    if (!tenantId) {
      console.error(`No demo tenant mapped for ${industryId}`);
      continue;
    }

    const existing = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) {
      await prisma.tenant.create({
        data: {
          id: tenantId,
          name: tenantId,
          plan: 'GROWTH',
          settings: {},
        },
      });
      console.log(`Created tenant shell: ${tenantId}`);
    }

    const serviceCount = await prisma.knowledgeDocument.count({
      where: { tenantId, isActive: true, docType: 'SERVICE' },
    });

    if (serviceCount === 0) {
      const { jsonPath, count } = await backupTenantKbToArtifacts({
        prisma,
        tenantId,
        label: `ensure-phase2a-${industryId}-preseed`,
        repoRoot: REPO_ROOT,
      });
      console.log(`KB backup (${count} docs) before seed: ${jsonPath}`);

      const { kbCount, displayName } = await applyIndustrySeedToTenant(prisma, tenantId, industryId);
      console.log(`Seeded ${industryId} → ${tenantId}: ${displayName}, ${kbCount} docs`);
    } else {
      const faqCount = await prisma.knowledgeDocument.count({
        where: { tenantId, isActive: true, docType: 'FAQ' },
      });
      if (faqCount === 0) {
        console.warn(
          `[ensure-phase2a] WARN: ${tenantId} has ${serviceCount} SERVICE but 0 FAQ — partial KB; smoke:industries may fail.`,
        );
      }
      console.log(`Skip seed ${industryId}: already has ${serviceCount} SERVICE rows`);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
