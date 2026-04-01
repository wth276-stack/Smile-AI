import { prisma } from '../client';

type DuplicateGroup = {
  tenantId: string;
  phone: string;
  count: bigint | number;
};

const EXECUTE = process.argv.includes('--execute');

async function main() {
  console.log(`[merge-duplicates] Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`);
  if (!EXECUTE) {
    console.log('[merge-duplicates] No changes will be written. Add --execute to apply.');
  }

  const groups = await prisma.$queryRaw<DuplicateGroup[]>`
    SELECT "tenantId", "phone", COUNT(*) AS "count"
    FROM "contacts"
    WHERE "phone" IS NOT NULL AND TRIM("phone") <> ''
    GROUP BY "tenantId", "phone"
    HAVING COUNT(*) > 1
    ORDER BY "tenantId", "phone";
  `;

  if (groups.length === 0) {
    console.log('[merge-duplicates] No duplicate groups found.');
    return;
  }

  console.log(`[merge-duplicates] Found ${groups.length} duplicate group(s).`);

  for (const group of groups) {
    const contacts = await prisma.contact.findMany({
      where: { tenantId: group.tenantId, phone: group.phone },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true },
    });

    if (contacts.length < 2) continue;

    const keep = contacts[0];
    const dupes = contacts.slice(1);
    console.log(
      `\n[group] tenantId=${group.tenantId} phone=${group.phone} keep=${keep.id} duplicates=${dupes.length}`,
    );

    for (const dup of dupes) {
      console.log(`  [plan] reassign conversations from ${dup.id} -> ${keep.id}`);
      console.log(`  [plan] reassign orders from ${dup.id} -> ${keep.id}`);
      console.log(`  [plan] reassign bookings from ${dup.id} -> ${keep.id}`);
      console.log(`  [plan] reassign follow-up tasks from ${dup.id} -> ${keep.id}`);
      console.log(`  [plan] delete contact ${dup.id}`);
    }

    if (!EXECUTE) continue;

    console.log(`  [execute] starting transaction for phone=${group.phone}`);
    try {
      await prisma.$transaction(async (tx) => {
        for (const dup of dupes) {
          console.log(`    [execute] UPDATE conversations for duplicate=${dup.id}`);
          await tx.conversation.updateMany({
            where: { tenantId: group.tenantId, contactId: dup.id },
            data: { contactId: keep.id },
          });

          console.log(`    [execute] UPDATE orders for duplicate=${dup.id}`);
          await tx.order.updateMany({
            where: { tenantId: group.tenantId, contactId: dup.id },
            data: { contactId: keep.id },
          });

          console.log(`    [execute] UPDATE bookings for duplicate=${dup.id}`);
          await tx.booking.updateMany({
            where: { tenantId: group.tenantId, contactId: dup.id },
            data: { contactId: keep.id },
          });

          console.log(`    [execute] UPDATE follow_up_tasks for duplicate=${dup.id}`);
          await tx.followUpTask.updateMany({
            where: { tenantId: group.tenantId, contactId: dup.id },
            data: { contactId: keep.id },
          });

          console.log(`    [execute] DELETE contact duplicate=${dup.id}`);
          await tx.contact.delete({
            where: { id: dup.id },
          });
        }
      });
      console.log(`  [execute] committed for phone=${group.phone}`);
    } catch (error) {
      console.error(`  [execute] failed for phone=${group.phone}:`, error);
      throw error;
    }
  }
}

main()
  .catch((error) => {
    console.error('[merge-duplicates] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

