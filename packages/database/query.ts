import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true }
  });
  console.log('Tenants:', JSON.stringify(tenants, null, 2));

  const docs = await prisma.knowledgeDocument.findMany({
    select: {
      id: true,
      title: true,
      docType: true,
      price: true,
      discountPrice: true,
      steps: true,
      tenantId: true
    },
    orderBy: { updatedAt: 'desc' },
    take: 10
  });
  console.log('KB Docs:', JSON.stringify(docs, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());