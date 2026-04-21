/**
 * One-off: remove 5 legacy beauty KB docs that overlap canonical imports for demo-tenant only.
 * Usage: pnpm exec tsx scripts/delete-demo-overlap-kb-docs.ts [--apply]
 */

import { PrismaClient } from '@prisma/client';

const TENANT_ID = 'demo-tenant';

const TITLES_TO_DELETE = [
  'HIFU 緊緻療程',
  'IPL 彩光嫩膚',
  '預約流程',
  '退款政策',
  '營業時間',
] as const;

const VERIFY_PRESENT = [
  'HIFU 高強度聚焦超聲波',
  '彩光（IPL）嫩膚',
  '眼部特別護理 Eye Treatment',
  '預約與改期取消 FAQ',
  '付款方式 FAQ',
  'Botox 瘦面療程',
];

async function main() {
  const apply = process.argv.includes('--apply');
  const prisma = new PrismaClient();

  try {
    const before = await prisma.knowledgeDocument.count({
      where: { tenantId: TENANT_ID },
    });
    console.log(`demo-tenant KnowledgeDocument count (before): ${before}`);

    const found = await prisma.knowledgeDocument.findMany({
      where: { tenantId: TENANT_ID, title: { in: [...TITLES_TO_DELETE] } },
      select: { id: true, title: true },
    });
    console.log(`Rows matching delete list (${found.length}):`);
    for (const r of found) console.log(`  - ${r.title} (${r.id})`);

    const missing = TITLES_TO_DELETE.filter(
      (t) => !found.some((r) => r.title === t),
    );
    if (missing.length) {
      console.log('Titles in list but NOT found (skipped):', missing.join(', '));
    }

    if (!apply) {
      console.log('\nDry-run. Pass --apply to delete.');
      return;
    }

    const result = await prisma.knowledgeDocument.deleteMany({
      where: {
        tenantId: TENANT_ID,
        title: { in: [...TITLES_TO_DELETE] },
      },
    });
    console.log(`\ndeleteMany count: ${result.count}`);

    const after = await prisma.knowledgeDocument.count({
      where: { tenantId: TENANT_ID },
    });
    console.log(`demo-tenant KnowledgeDocument count (after): ${after}`);

    for (const title of VERIFY_PRESENT) {
      const row = await prisma.knowledgeDocument.findFirst({
        where: { tenantId: TENANT_ID, title },
        select: { title: true },
      });
      console.log(row ? `OK still present: ${title}` : `MISSING: ${title}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
