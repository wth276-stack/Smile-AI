const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Fixing user tenant association...\n');

  // Delete existing demo users
  const deleted = await prisma.user.deleteMany({
    where: { email: 'demo@example.com' }
  });
  console.log(`Deleted ${deleted.count} existing user(s)`);

  // Create user in demo-tenant
  const passwordHash = await bcrypt.hash('demo123456', 12);

  const user = await prisma.user.create({
    data: {
      tenantId: 'demo-tenant',
      email: 'demo@example.com',
      passwordHash,
      name: 'Demo Admin',
      role: 'OWNER',
    }
  });

  console.log(`\n✅ Created user:`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Tenant: ${user.tenantId}`);
  console.log(`   Role: ${user.role}`);
}

main()
  .catch((e) => console.error('Error:', e))
  .finally(() => prisma.$disconnect());