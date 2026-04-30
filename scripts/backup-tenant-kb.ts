/**
 * READ-ONLY backup: export KnowledgeDocument rows for one tenant to timestamped files.
 *
 * Usage:
 *   pnpm exec tsx scripts/backup-tenant-kb.ts --tenant-id demo-tenant [--label before-ui-work]
 *
 * PowerShell tip: chain commands with `;` instead of `&&` (PS 5.x).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { backupTenantKbToArtifacts } from './kb-backup-artifacts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

config({ path: path.join(REPO_ROOT, '.env') });

function argValue(name: string, fallback = ''): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === name && argv[i + 1]) return argv[i + 1];
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return fallback;
}

async function main() {
  const tenantId = argValue('--tenant-id', 'demo-tenant').trim();
  let label = argValue('--label', 'manual').trim();
  label = label.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!tenantId) {
    throw new Error('Missing --tenant-id');
  }

  const prisma = new PrismaClient();
  try {
    const { jsonPath, mdPath, count, byType, idTitleSha256 } = await backupTenantKbToArtifacts({
      prisma,
      tenantId,
      label,
      repoRoot: REPO_ROOT,
    });
    console.log(`Backed up ${count} KB documents for tenant ${tenantId}`);
    console.log(`JSON: ${jsonPath}`);
    console.log(`MD:   ${mdPath}`);
    console.log('By docType:', byType);
    console.log(`idTitle SHA-256: ${idTitleSha256}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
