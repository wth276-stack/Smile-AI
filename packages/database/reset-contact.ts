const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function resetContact() {
  try {
    const result = await prisma.contact.update({
      where: { id: 'demo-contact' },
      data: {
        name: null,
        phone: null,
        tags: []
      }
    });
    console.log('Contact reset to empty state:', result.id);
    console.log('name:', result.name);
    console.log('phone:', result.phone);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetContact();