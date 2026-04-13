const { PrismaClient } = require('./packages/database');
const p = new PrismaClient();
p.knowledgeDocument.findMany({
  where: { tenantId: 'cmnmzdqhy0000qp0c035jxvpz', isActive: true },
  select: { id: true, title: true, docType: true, aliases: true, content: true }
})
  .then(r => {
    console.log(`Total docs: ${r.length}`);
    r.forEach(d => console.log(`  [${d.docType}] ${d.title} | aliases: ${JSON.stringify(d.aliases)} | content: ${d.content.slice(0,60)}...`));
  })
  .finally(() => p.$disconnect());
