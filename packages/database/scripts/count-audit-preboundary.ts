import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c
    FROM ai_runs
    WHERE signals->'_auditPreBoundary' IS NOT NULL
  `;
  console.log(JSON.stringify({ aiRunsWithAuditPreBoundary: Number(rows[0]?.c ?? 0) }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
