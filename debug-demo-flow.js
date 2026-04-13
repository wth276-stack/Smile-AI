const { PrismaClient } = require('./packages/database');
const p = new PrismaClient();
(async () => {
  // Simulate exactly what chat controller does
  try {
    const contact = await p.contact.findFirst({ where: { tenantId: 'demo-tenant' } });
    console.log('Contact lookup:', contact ? 'OK' : 'No contacts yet (OK)');
    
    const conv = await p.conversation.findFirst({ where: { tenantId: 'demo-tenant' } });
    console.log('Conversation lookup:', conv ? 'OK' : 'No convs yet (OK)');
    
    // This is most likely where it fails - try creating a contact
    const newContact = await p.contact.create({
      data: { tenantId: 'demo-tenant', externalIds: { WEBCHAT: 'test-debug' } }
    });
    console.log('Contact create: OK', newContact.id);
    
    // Cleanup
    await p.contact.delete({ where: { id: newContact.id } });
    console.log('Cleanup OK');
  } catch (e) {
    console.error('FAILED:', e.message);
    console.error('Code:', e.code);
  }
  await p.$disconnect();
})();
