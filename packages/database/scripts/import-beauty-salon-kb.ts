/**
 * Import kb/beauty-salon markdown into KnowledgeDocument (tenantId + title upsert).
 * Usage: tsx scripts/import-beauty-salon-kb.ts --tenant-id <id> [--apply]
 * Default: dry-run (no writes). Prints would-create / would-update counts before --apply.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DocType, PrismaClient } from '@prisma/client';

import {
  buildTopicalFaqDocs,
  KB_SOURCE_FILES,
  type NormalizedKbRow,
  parseServiceBlock,
  splitServiceBlocks,
  toNormalizedRow,
} from './lib/beauty-kb-parse';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getTenantId(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant-id' && argv[i + 1]) return argv[i + 1];
    if (a.startsWith('--tenant-id=')) return a.slice('--tenant-id='.length);
  }
  return '';
}

function loadAllRows(): NormalizedKbRow[] {
  const kbDir = join(__dirname, '../../../kb/beauty-salon');
  const rows: NormalizedKbRow[] = [];
  for (const file of KB_SOURCE_FILES) {
    const md = readFileSync(join(kbDir, file), 'utf8');
    for (const block of splitServiceBlocks(md)) {
      const parsed = parseServiceBlock(block);
      rows.push(toNormalizedRow(parsed));
    }
  }
  rows.push(...buildTopicalFaqDocs());
  return rows;
}

function rowToPrismaData(row: NormalizedKbRow, tenantId: string) {
  return {
    tenantId,
    title: row.title,
    content: row.content,
    category: row.category ?? null,
    docType: row.docType === 'SERVICE' ? DocType.SERVICE : DocType.FAQ,
    price: row.price,
    discountPrice: row.discountPrice,
    effect: row.effect,
    suitable: row.suitable,
    unsuitable: row.unsuitable,
    precaution: row.precaution,
    duration: row.duration,
    steps: row.steps,
    faqItems: row.faqItems.length ? (row.faqItems as object) : undefined,
    aliases: row.aliases,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const tenantId = getTenantId(argv);
  if (!tenantId) {
    console.error('Error: --tenant-id <id> is required (e.g. --tenant-id demo-tenant)');
    process.exit(1);
  }
  const apply = argv.includes('--apply');

  const rows = loadAllRows();
  console.log(`Loaded ${rows.length} knowledge rows from beauty-salon KB (${KB_SOURCE_FILES.length} files + 6 FAQ docs).`);

  const prisma = new PrismaClient();
  try {
    let wouldCreate = 0;
    let wouldUpdate = 0;

    for (const row of rows) {
      const existing = await prisma.knowledgeDocument.findFirst({
        where: { tenantId, title: row.title },
        select: { id: true },
      });
      if (existing) wouldUpdate += 1;
      else wouldCreate += 1;
    }

    console.log('');
    console.log(`Tenant: ${tenantId}`);
    console.log(`Would create: ${wouldCreate}`);
    console.log(`Would update: ${wouldUpdate}`);
    console.log('');

    if (!apply) {
      console.log('Dry-run only (no DB writes). Pass --apply to upsert rows.');
      return;
    }

    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const data = rowToPrismaData(row, tenantId);
      const existing = await prisma.knowledgeDocument.findFirst({
        where: { tenantId, title: row.title },
        select: { id: true },
      });

      if (existing) {
        await prisma.knowledgeDocument.update({
          where: { id: existing.id },
          data,
        });
        updated += 1;
      } else {
        await prisma.knowledgeDocument.create({ data });
        created += 1;
      }
    }

    console.log(`Applied: created ${created}, updated ${updated}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
