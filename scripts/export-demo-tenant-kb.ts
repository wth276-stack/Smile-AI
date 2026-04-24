/**
 * READ-ONLY export: dumps all KnowledgeDocument rows for tenant `demo-tenant` to local files.
 * Does not write to the database. Safe to re-run.
 *
 * Prerequisite: @prisma/client available (use workspace; run from repo root with pnpm exec tsx).
 *
 *   pnpm exec tsx scripts/export-demo-tenant-kb.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaClient, type DocType, type Prisma } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

config({ path: path.join(REPO_ROOT, '.env') });

const TENANT_ID = 'demo-tenant';
const ARTIFACTS = path.join(REPO_ROOT, 'artifacts');

const prisma = new PrismaClient();

type KbRow = Prisma.KnowledgeDocumentGetPayload<{ select: undefined }>;

function countByDocType(rows: { docType: DocType }[]): Record<string, number> {
  const m: Record<string, number> = { SERVICE: 0, FAQ: 0, GENERAL: 0 };
  for (const r of rows) {
    m[r.docType] = (m[r.docType] ?? 0) + 1;
  }
  return m;
}

function findDuplicateTitles(rows: { title: string; id: string }[]): { title: string; ids: string[] }[] {
  const byTitle = new Map<string, string[]>();
  for (const r of rows) {
    const a = byTitle.get(r.title) ?? [];
    a.push(r.id);
    byTitle.set(r.title, a);
  }
  return [...byTitle.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([title, ids]) => ({ title, ids }));
}

function contentChecksum(rows: { id: string; title: string }[]): string {
  const s = rows
    .map((r) => `${r.id}\t${r.title}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function escMd(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true });

  const rows = await prisma.knowledgeDocument.findMany({
    where: { tenantId: TENANT_ID },
    orderBy: [{ docType: 'asc' }, { title: 'asc' }, { id: 'asc' }],
  });

  const exportedAt = new Date().toISOString();
  const byType = countByDocType(rows);
  const dups = findDuplicateTitles(rows);
  const checksum = contentChecksum(rows);

  const jsonPayload = {
    _export: {
      readOnly: true,
      source: 'KnowledgeDocument',
      tenantId: TENANT_ID,
      exportedAt,
      documentCount: rows.length,
      countByDocType: byType,
      duplicateTitleGroups: dups,
      idTitleSha256: checksum,
      note: 'Preservation snapshot of DB state; may differ from industry-seeds.ts. demo/reset or seed can overwrite.',
    },
    documents: rows,
  };

  const jsonPath = path.join(ARTIFACTS, 'demo-tenant-kb-snapshot.json');
  writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), 'utf8');

  const byDoc: Record<DocType, KbRow[]> = { SERVICE: [], FAQ: [], GENERAL: [] };
  for (const r of rows) {
    byDoc[r.docType].push(r);
  }

  const md: string[] = [];
  md.push(`# demo-tenant Knowledge base snapshot — READ ONLY`);
  md.push(``);
  md.push(`**Tenant:** \`${TENANT_ID}\``);
  md.push(`**Exported at (ISO):** ${exportedAt}`);
  md.push(``);
  md.push(`> This file is a **preservation snapshot** of \`KnowledgeDocument\` rows as they existed in the database at export time.`);
  md.push(`> It may **differ** from \`packages/database/src/industry-seeds.ts\` (source-of-truth for *new* seeds).`);
  md.push(`> \`applyIndustrySeedToTenant\`, \`db:seed:demo\`, and \`POST /api/demo/reset\` can **replace or remove** all KB rows for this tenant — export again before such operations if you need a backup.`);
  md.push(``);
  md.push(`## Summary`);
  md.push(``);
  md.push(`| Metric | Value |`);
  md.push(`|--------|--------|`);
  md.push(`| Total documents | ${rows.length} |`);
  md.push(`| SERVICE | ${byType.SERVICE ?? 0} |`);
  md.push(`| FAQ | ${byType.FAQ ?? 0} |`);
  md.push(`| GENERAL | ${byType.GENERAL ?? 0} |`);
  md.push(`| SHA-256 (sorted id + tab + title) | \`${checksum}\` |`);
  md.push(``);
  md.push(`## Duplicate titles (same title, multiple rows)`);
  md.push(``);
  if (dups.length === 0) {
    md.push(`_None._`);
  } else {
    for (const d of dups) {
      md.push(`- **${escMd(d.title)}** — ids: \`${d.ids.join('`, `')}\``);
    }
  }
  md.push(``);

  for (const dt of ['SERVICE', 'FAQ', 'GENERAL'] as const) {
    md.push(`## ${dt}`);
    md.push(``);
    const list = byDoc[dt];
    if (list.length === 0) {
      md.push(`_No documents._`);
      md.push(``);
      continue;
    }
    for (const doc of list) {
      md.push(`### ${escMd(doc.title)}`);
      md.push(``);
      md.push(`- **id:** \`${doc.id}\``);
      md.push(`- **isActive:** ${doc.isActive}`);
      md.push(`- **createdAt:** ${doc.createdAt.toISOString()}`);
      md.push(`- **updatedAt:** ${doc.updatedAt.toISOString()}`);
      if (doc.category) md.push(`- **category:** ${doc.category}`);
      if (doc.tags?.length) md.push(`- **tags:** ${doc.tags.join(', ')}`);
      md.push(`- **aliases:** ${doc.aliases.length ? doc.aliases.map((a) => `\`${a}\``).join(', ') : '_(none)_'}`);
      if (doc.duration) md.push(`- **duration:** ${doc.duration}`);
      if (doc.price) md.push(`- **price:** ${doc.price}`);
      if (doc.discountPrice) md.push(`- **discountPrice:** ${doc.discountPrice}`);
      if (doc.effect) md.push(`- **effect:** ${doc.effect}`);
      if (doc.suitable) md.push(`- **suitable:** ${doc.suitable}`);
      if (doc.unsuitable) md.push(`- **unsuitable:** ${doc.unsuitable}`);
      if (doc.precaution) md.push(`- **precaution:** ${doc.precaution}`);
      if (doc.steps?.length) md.push(`- **steps:** ${doc.steps.join(' | ')}`);
      if (doc.faqItems != null) {
        md.push(`- **faqItems:** \`\`\`json`);
        md.push(`${JSON.stringify(doc.faqItems, null, 2)}`);
        md.push('```');
      }
      md.push(``);
      md.push(`**content**`);
      md.push(``);
      md.push('```');
      md.push(doc.content);
      md.push('```');
      md.push(``);
    }
  }

  const mdPath = path.join(ARTIFACTS, 'demo-tenant-kb-snapshot.md');
  writeFileSync(mdPath, md.join('\n'), 'utf8');

  await prisma.$disconnect();

  // eslint-disable-next-line no-console
  console.log(`Wrote ${rows.length} documents:`);
  // eslint-disable-next-line no-console
  console.log(`  ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`  ${mdPath}`);
  // eslint-disable-next-line no-console
  console.log(`By docType:`, byType);
  // eslint-disable-next-line no-console
  console.log(`idTitle SHA-256: ${checksum}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
