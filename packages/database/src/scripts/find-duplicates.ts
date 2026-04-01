import { prisma } from '../client';

type DuplicateGroup = {
  tenantId: string;
  phone: string;
  count: bigint | number;
};

async function main() {
  console.log('[find-duplicates] Scanning duplicate contacts by tenantId + phone...');

  const groups = await prisma.$queryRaw<DuplicateGroup[]>`
    SELECT "tenantId", "phone", COUNT(*) AS "count"
    FROM "contacts"
    WHERE "phone" IS NOT NULL AND TRIM("phone") <> ''
    GROUP BY "tenantId", "phone"
    HAVING COUNT(*) > 1
    ORDER BY "tenantId", "phone";
  `;

  if (groups.length === 0) {
    console.log('[find-duplicates] No duplicates found.');
    return;
  }

  console.log(`[find-duplicates] Found ${groups.length} duplicate group(s).`);

  for (const group of groups) {
    const duplicates = await prisma.contact.findMany({
      where: { tenantId: group.tenantId, phone: group.phone },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        _count: { select: { bookings: true } },
      },
    });

    const count = Number(group.count);
    console.log(`\n[Group] tenantId=${group.tenantId} phone=${group.phone} duplicates=${count}`);
    for (const contact of duplicates) {
      console.log(
        `  - id=${contact.id} createdAt=${contact.createdAt.toISOString()} bookings=${contact._count.bookings}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error('[find-duplicates] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

