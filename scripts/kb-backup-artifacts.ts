/**
 * Writes tenant KnowledgeDocument export under artifacts/kb-backups (shared helper).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DocType, PrismaClient } from '@prisma/client';

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

function safeStamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

function safeLabel(s: string): string {
  return s.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function backupTenantKbToArtifacts(opts: {
  prisma: PrismaClient;
  tenantId: string;
  /** Short tag, e.g. ensure-phase2a-cleaning-preseed */
  label: string;
  repoRoot: string;
}): Promise<{
  jsonPath: string;
  mdPath: string;
  count: number;
  byType: Record<string, number>;
  idTitleSha256: string;
}> {
  const { prisma, tenantId, label } = opts;
  const BACKUP_DIR = path.join(opts.repoRoot, 'artifacts', 'kb-backups');
  const safe = safeLabel(label);
  mkdirSync(BACKUP_DIR, { recursive: true });

  const rows = await prisma.knowledgeDocument.findMany({
    where: { tenantId },
    orderBy: [{ docType: 'asc' }, { title: 'asc' }, { id: 'asc' }],
  });

  const exportedAt = new Date();
  const stamp = safeStamp(exportedAt);
  const base = `${tenantId}-${stamp}${safe ? `-${safe}` : ''}`;
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
      note: 'Timestamped recovery backup. Keep before resets, seeds, dashboard edits.',
    },
    documents: rows,
  };

  const jsonPath = path.join(BACKUP_DIR, `${base}.json`);
  const mdPath = path.join(BACKUP_DIR, `${base}.md`);
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  const md = [
    `# KB backup: ${tenantId}`,
    '',
    `- Exported at: ${exportedAt.toISOString()}`,
    `- Documents: ${rows.length}`,
    `- SERVICE: ${byType.SERVICE ?? 0}`,
    `- FAQ: ${byType.FAQ ?? 0}`,
    `- GENERAL: ${byType.GENERAL ?? 0}`,
    `- id/title SHA-256: \`${idTitleSha256}\``,
    '',
    '## Titles',
    '',
    ...rows.map((r) => `- [${r.docType}] ${r.title} (${r.id})`),
    '',
  ];
  writeFileSync(mdPath, md.join('\n'), 'utf8');

  return { jsonPath, mdPath, count: rows.length, byType, idTitleSha256 };
}
