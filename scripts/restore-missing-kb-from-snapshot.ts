/**
 * Restore only titles that are missing from the current tenant KB.
 *
 * This is safer than a full replace when a reset partially restored the KB but changed row IDs.
 *
 * Usage:
 *   pnpm exec tsx scripts/restore-missing-kb-from-snapshot.ts --tenant-id demo-tenant --snapshot artifacts/demo-tenant-kb-snapshot.json
 *   pnpm exec tsx scripts/restore-missing-kb-from-snapshot.ts --tenant-id demo-tenant --snapshot artifacts/demo-tenant-kb-snapshot.json --apply
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaClient, type DocType } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

config({ path: path.join(REPO_ROOT, '.env') });

type SnapshotDoc = {
  tenantId: string;
  title: string;
  content: string;
  category?: string | null;
  tags?: string[];
  isActive?: boolean;
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
  _export?: { tenantId?: string; documentCount?: number };
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

function priorityFor(docType: DocType): number {
  if (docType === 'SERVICE') return 100;
  if (docType === 'FAQ') return 80;
  return 50;
}

function toCreateData(doc: SnapshotDoc, tenantId: string) {
  const docType = doc.docType ?? 'GENERAL';
  return {
    tenantId,
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
  };
}

function uniqueByTitle(docs: SnapshotDoc[]): {
  unique: SnapshotDoc[];
  duplicateTitles: string[];
} {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unique: SnapshotDoc[] = [];
  for (const doc of docs) {
    if (seen.has(doc.title)) {
      duplicates.add(doc.title);
      continue;
    }
    seen.add(doc.title);
    unique.push(doc);
  }
  return { unique, duplicateTitles: [...duplicates].sort() };
}

async function main() {
  const tenantId = argValue('--tenant-id', 'demo-tenant').trim();
  const snapshotPath = argValue('--snapshot', 'artifacts/demo-tenant-kb-snapshot.json').trim();
  const apply = hasFlag('--apply');
  if (!tenantId) throw new Error('Missing --tenant-id');

  const snapshot = parseSnapshot(snapshotPath);
  const { unique, duplicateTitles } = uniqueByTitle(snapshot.documents);

  const prisma = new PrismaClient();
  try {
    const current = await prisma.knowledgeDocument.findMany({
      where: { tenantId },
      select: { title: true, docType: true },
      orderBy: [{ docType: 'asc' }, { title: 'asc' }],
    });
    const currentTitles = new Set(current.map((d) => d.title));
    const missing = unique.filter((doc) => !currentTitles.has(doc.title));

    console.log(`Tenant: ${tenantId}`);
    console.log(`Snapshot: ${snapshotPath}`);
    console.log(`Snapshot source tenant: ${snapshot._export?.tenantId ?? '(unknown)'}`);
    console.log(`Snapshot docs: ${snapshot.documents.length}; unique titles: ${unique.length}`);
    if (duplicateTitles.length) {
      console.log(`Duplicate titles in snapshot ignored for missing-title restore: ${duplicateTitles.join(', ')}`);
    }
    console.log(`Current docs: ${current.length}; unique titles: ${currentTitles.size}`);
    console.log(`Missing titles to create: ${missing.length}`);
    for (const doc of missing) {
      console.log(`  - [${doc.docType ?? 'GENERAL'}] ${doc.title}`);
    }

    if (!apply) {
      console.log('\nDry-run only. Pass --apply to create missing titles.');
      return;
    }

    for (const doc of missing) {
      await prisma.knowledgeDocument.create({
        data: toCreateData(doc, tenantId) as never,
      });
    }

    const after = await prisma.knowledgeDocument.findMany({
      where: { tenantId },
      select: { title: true, docType: true },
    });
    console.log(`\nCreated ${missing.length} missing KB documents.`);
    console.log(`After docs: ${after.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
