const { PrismaClient } = require('./packages/database');
const p = new PrismaClient();
p.knowledgeDocument.count({
  where: { tenantId: 'cmnmzdqhy0000qp0c035jxvpz', isActive: true }
})
  .then(c => console.log('Active KB docs:', c))
  .finally(() => p.$disconnect());
