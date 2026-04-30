/**
 * Restore tenant KnowledgeDocument rows from a JSON snapshot.
 *
 * Safe by default: dry-run only. To replace current tenant KB with the snapshot:
 *
 *   pnpm exec tsx scripts/restore-tenant-kb-from-snapshot.ts `
 *     --tenant-id demo-tenant `
 *     --snapshot artifacts/demo-tenant-kb-snapshot.json `
 *     --replace `
 *     --apply
 *
 * On --apply, a timestamped backup is created first unless --no-backup is passed.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaClient, type DocType } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const BACKUP_DIR = path.join(REPO_ROOT, 'artifacts', 'kb-backups');

config({ path: path.join(REPO_ROOT, '.env') });

type SnapshotDoc = {
  id: string;
  tenantId: string;
  title: string;
  content: string;
  category?: string | null;
  tags?: string[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
  duration?: string | null;
  effect?: string | null;
  precaution?: string | null;
  suitable?: string | null;
  unsuitable?: string | null;
  docType?: DocType;
  discountPrice?: string | null;
  faqItems?: unknown;
  price?: string | null;
  steps?: string[];
  aliases?: string[];
  priority?: number;
};

type SnapshotPayload = {
  _export?: {
    tenantId?: string;
    documentCount?: number;
    countByDocType?: Record<string, number>;
    exportedAt?: string;
  };
  documents: SnapshotDoc[];
};

function argValue(name: string, fallback = ''): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === name && argv[i + 1]) return argv[i + 1];
    if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
  }
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function safeStamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

function countByDocType(rows: { docType: DocType }[]): Record<string, number> {
  const counts: Record<string, number> = { SERVICE: 0, FAQ: 0, GENERAL: 0 };
  for (const row of rows) counts[row.docType] = (counts[row.docType] ?? 0) + 1;
  return counts;
}

function checksum(rows: { id: string; title: string }[]): string {
  const body = rows
    .map((r) => `${r.id}\t${r.title}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function priorityFor(docType: DocType): number {
  if (docType === 'SERVICE') return 100;
  if (docType === 'FAQ') return 80;
  return 50;
}

function parseSnapshot(snapshotPath: string): SnapshotPayload {
  const fullPath = path.isAbsolute(snapshotPath)
    ? snapshotPath
    : path.join(REPO_ROOT, snapshotPath);
  const raw = JSON.parse(readFileSync(fullPath, 'utf8')) as SnapshotPayload;
  if (!Array.isArray(raw.documents)) {
    throw new Error(`Invalid snapshot: ${snapshotPath} does not contain documents[]`);
  }
  return raw;
}

async function backupCurrent(prisma: PrismaClient, tenantId: string): Promise<void> {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const rows = await prisma.knowledgeDocument.findMany({
    where: { tenantId },
    orderBy: [{ docType: 'asc' }, { title: 'asc' }, { id: 'asc' }],
  });
  const exportedAt = new Date();
  const base = `${tenantId}-${safeStamp(exportedAt)}-pre-restore`;
  const byType = countByDocType(rows);
  const idTitleSha256 = checksum(rows);
  const payload = {
    _export: {
      readOnly: true,
      source: 'KnowledgeDocument',
      tenantId,
      exportedAt: exportedAt.toISOString(),
      documentCount: rows.length,
      countByDocType: byType,
      idTitleSha256,
      note: 'Automatic backup before restore-tenant-kb-from-snapshot.',
    },
    documents: rows,
  };
  const jsonPath = path.join(BACKUP_DIR, `${base}.json`);
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`Pre-restore backup written: ${jsonPath}`);
}

function toPrismaData(doc: SnapshotDoc, targetTenantId: string) {
  const docType = doc.docType ?? 'GENERAL';
  return {
    id: doc.id,
    tenantId: targetTenantId,
    title: doc.title,
    content: doc.content,
    category: doc.category ?? null,
    tags: doc.tags ?? [],
    isActive: doc.isActive ?? true,
    duration: doc.duration ?? null,
    effect: doc.effect ?? null,
    precaution: doc.precaution ?? null,
    suitable: doc.suitable ?? null,
    unsuitable: doc.unsuitable ?? null,
    docType,
    discountPrice: doc.discountPrice ?? null,
    faqItems: doc.faqItems === undefined ? undefined : doc.faqItems,
    price: doc.price ?? null,
    steps: doc.steps ?? [],
    aliases: doc.aliases ?? [],
    priority: doc.priority ?? priorityFor(docType),
    ...(doc.createdAt ? { createdAt: new Date(doc.createdAt) } : {}),
    ...(doc.updatedAt ? { updatedAt: new Date(doc.updatedAt) } : {}),
  };
}

async function main() {
  const tenantId = argValue('--tenant-id', 'demo-tenant').trim();
  const snapshotPath = argValue('--snapshot', 'artifacts/demo-tenant-kb-snapshot.json').trim();
  const apply = hasFlag('--apply');
  const replace = hasFlag('--replace');
  const noBackup = hasFlag('--no-backup');

  if (!tenantId) throw new Error('Missing --tenant-id');

  const snapshot = parseSnapshot(snapshotPath);
  const docs = snapshot.documents;
  const snapshotIds = new Set(docs.map((d) => d.id));
  const expectedByType = countByDocType(docs.map((d) => ({ docType: d.docType ?? 'GENERAL' })));

  const prisma = new PrismaClient();
  try {
    const current = await prisma.knowledgeDocument.findMany({
      where: { tenantId },
      select: { id: true, title: true, docType: true },
    });
    const currentIds = new Set(current.map((d) => d.id));
    const createCount = docs.filter((d) => !currentIds.has(d.id)).length;
    const updateCount = docs.length - createCount;
    const deleteCount = replace ? current.filter((d) => !snapshotIds.has(d.id)).length : 0;

    console.log(`Tenant: ${tenantId}`);
    console.log(`Snapshot: ${snapshotPath}`);
    console.log(`Snapshot source tenant: ${snapshot._export?.tenantId ?? '(unknown)'}`);
    console.log(`Snapshot docs: ${docs.length}`, expectedByType);
    console.log(`Current docs: ${current.length}`, countByDocType(current));
    console.log(`Would create: ${createCount}`);
    console.log(`Would update: ${updateCount}`);
    console.log(`Would delete: ${deleteCount}${replace ? '' : ' (pass --replace to delete docs not in snapshot)'}`);

    if (!apply) {
      console.log('\nDry-run only. Pass --apply to write changes.');
      return;
    }

    if (!noBackup) {
      await backupCurrent(prisma, tenantId);
    }

    if (replace && deleteCount > 0) {
      await prisma.knowledgeDocument.deleteMany({
        where: {
          tenantId,
          id: { notIn: [...snapshotIds] },
        },
      });
    }

    let created = 0;
    let updated = 0;
    for (const doc of docs) {
      const data = toPrismaData(doc, tenantId);
      const exists = await prisma.knowledgeDocument.findUnique({
        where: { id: doc.id },
        select: { id: true, tenantId: true },
      });
      if (exists && exists.tenantId !== tenantId) {
        throw new Error(`Snapshot id ${doc.id} already belongs to another tenant (${exists.tenantId})`);
      }
      if (exists) {
        const { id: _id, createdAt: _createdAt, ...updateData } = data;
        await prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: updateData as never,
        });
        updated += 1;
      } else {
        await prisma.knowledgeDocument.create({ data: data as never });
        created += 1;
      }
    }

    const after = await prisma.knowledgeDocument.findMany({
      where: { tenantId },
      select: { id: true, title: true, docType: true },
    });
    console.log('\nRestore applied.');
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Deleted: ${deleteCount}`);
    console.log(`After docs: ${after.length}`, countByDocType(after));
    console.log(`After id/title SHA-256: ${checksum(after)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
