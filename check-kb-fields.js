const { PrismaClient } = require('./packages/database');
const p = new PrismaClient();
(async () => {
  const docs = await p.knowledgeDocument.findMany({
    where: { tenantId: 'demo-tenant', isActive: true },
    select: { id: true, title: true, aliases: true, price: true, duration: true }
  });
  console.log(`Total: ${docs.length}`);
  docs.forEach(d => {
    const issues = [];
    if (d.aliases && !Array.isArray(d.aliases)) issues.push('aliases not array');
    if (d.price && typeof d.price !== 'string') issues.push(`price type: ${typeof d.price}`);
    if (d.duration && typeof d.duration !== 'string') issues.push(`duration type: ${typeof d.duration}`);
    if (issues.length) console.log(`  ISSUE: ${d.id} | ${d.title} | ${issues.join(', ')}`);
  });
  console.log('Field check done');
  await p.$disconnect();
})();
