const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Checking database...\n');

  const tenant = await prisma.tenant.findUnique({ where: { id: 'demo-tenant' } });
  console.log('=== Tenant ===');
  console.log(tenant ? `✅ ${tenant.name} (${tenant.id})` : '❌ Not found');

  const user = await prisma.user.findFirst({ where: { email: 'demo@example.com' } });
  console.log('\n=== User ===');
  if (user) {
    console.log(`✅ ${user.email}`);
    console.log(`   tenantId: ${user.tenantId}`);
    console.log(`   role: ${user.role}`);
  } else {
    console.log('❌ Not found');
  }

  const contact = await prisma.contact.findFirst({ where: { tenantId: 'demo-tenant' } });
  console.log('\n=== Contact ===');
  if (contact) {
    console.log(`✅ ${contact.name || 'No name'} (${contact.id})`);
    console.log(`   externalIds: ${JSON.stringify(contact.externalIds)}`);
  } else {
    console.log('❌ Not found');
  }

  const conversations = await prisma.conversation.findMany({
    where: { tenantId: 'demo-tenant' },
    include: { contact: true },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  console.log('\n=== Conversations ===');
  console.log(`Count: ${conversations.length}`);
  conversations.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.id} | ${c.channel} | ${c.contact?.name || 'Unknown'} | ${c.status}`);
  });

  const messages = await prisma.message.findMany({
    where: { conversation: { tenantId: 'demo-tenant' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log('\n=== Recent Messages ===');
  console.log(`Count: ${messages.length}`);
  messages.forEach((m, i) => {
    console.log(`  ${i + 1}. [${m.sender}] ${m.content.substring(0, 50)}...`);
  });
}

main()
  .catch((e) => console.error('Error:', e))
  .finally(() => prisma.$disconnect());