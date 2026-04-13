const { PrismaClient } = require('./packages/database');
const p = new PrismaClient();
(async () => {
  // Simulate what chat service does: find KB docs for demo-tenant
  const docs = await p.knowledgeDocument.findMany({
    where: { tenantId: 'demo-tenant', isActive: true }
  });
  console.log(`KB docs: ${docs.length}`);
  
  // Check if any doc has null/undefined fields that could crash formatKnowledgeChunks
  for (const d of docs) {
    if (typeof d.content !== 'string') console.log(`BAD content: ${d.id} ${d.title}`);
    if (typeof d.title !== 'string') console.log(`BAD title: ${d.id}`);
  }
  console.log('All docs field check passed');
  await p.$disconnect();
})();
