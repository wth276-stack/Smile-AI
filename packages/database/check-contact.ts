const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkContact() {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: 'demo-contact' }
    });
    console.log('Contact record:', JSON.stringify(contact, null, 2));

    const tenant = await prisma.tenant.findUnique({
      where: { id: 'demo-tenant' }
    });
    console.log('\nTenant record:', JSON.stringify(tenant, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkContact();