const { PrismaClient } = require('./packages/database');
const p = new PrismaClient();
p.tenant.findMany({ select: { id: true, name: true } })
  .then(r => r.forEach(t => console.log(`${t.id} | ${t.name}`)))
  .finally(() => p.$disconnect());
