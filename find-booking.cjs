const { PrismaClient } = require('./packages/database/node_modules/.prisma/client');
const prisma = new PrismaClient();
prisma.booking.findMany({
  where: { tenantId: 'cmnmzdqhy0000qp0c035jxvpz', status: { not: 'CANCELLED' } },
  include: { contact: { select: { id: true, name: true, externalId: true } } },
  orderBy: { createdAt: 'desc' },
  take: 5
}).then(r => console.log(JSON.stringify(r, null, 2))).finally(() => prisma.$disconnect());
