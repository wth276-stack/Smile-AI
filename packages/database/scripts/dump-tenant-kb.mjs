import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
const raw = readFileSync(envPath, 'utf8');
const m = raw.match(/^DATABASE_URL=(.+)$/m);
if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '');

const tenantId = process.argv[2] || 'demo-tenant';
const prisma = new PrismaClient();
const rows = await prisma.knowledgeDocument.findMany({
  where: { tenantId },
  select: { id: true, title: true, docType: true, aliases: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
});
console.log(JSON.stringify({ tenantId, count: rows.length, rows }, null, 2));
await prisma.$disconnect();
