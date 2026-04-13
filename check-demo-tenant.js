const { PrismaClient } = require('./packages/database');
const p = new PrismaClient();
(async () => {
  const tenant = await p.tenant.findUnique({ where: { id: 'demo-tenant' } });
  console.log('Tenant:', JSON.stringify(tenant, null, 2));

  const settings = await p.tenantSettings.findFirst({ where: { tenantId: 'demo-tenant' } });
  console.log('\nSettings:', JSON.stringify(settings, null, 2));

  await p.$disconnect();
})();
