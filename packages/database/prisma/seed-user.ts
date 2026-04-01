const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

const TENANT_ID = 'demo-tenant';
const USER_EMAIL = 'demo@example.com';

async function main() {
  const passwordHash = await bcrypt.hash('demo123456', 12);

  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: TENANT_ID, email: USER_EMAIL } },
    update: {
      passwordHash,
      name: 'Demo Admin',
    },
    create: {
      tenantId: TENANT_ID,
      email: USER_EMAIL,
      passwordHash,
      name: 'Demo Admin',
      role: UserRole.OWNER,
    },
  });

  console.log('✅ User created/updated:');
  console.log('   Email: demo@example.com');
  console.log('   Password: demo123456');
  console.log('   Tenant: demo-tenant');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());