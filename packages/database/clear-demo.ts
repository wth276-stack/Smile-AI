const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clearDemoConversations() {
  try {
    // Find demo tenant conversations
    const conversations = await prisma.conversation.findMany({
      where: { tenantId: 'demo-tenant' },
      select: { id: true }
    });

    const convIds = conversations.map(c => c.id);
    console.log('Found', convIds.length, 'conversations for demo-tenant');

    if (convIds.length === 0) {
      console.log('No conversations to delete');
      return;
    }

    // Delete AiRun records first (due to foreign key constraint)
    const deletedAiRuns = await prisma.aiRun.deleteMany({
      where: { conversationId: { in: convIds } }
    });
    console.log('Deleted', deletedAiRuns.count, 'AiRun records');

    // Delete Messages
    const deletedMessages = await prisma.message.deleteMany({
      where: { conversationId: { in: convIds } }
    });
    console.log('Deleted', deletedMessages.count, 'messages');

    // Delete Conversations
    const deletedConvs = await prisma.conversation.deleteMany({
      where: { tenantId: 'demo-tenant' }
    });
    console.log('Deleted', deletedConvs.count, 'conversations');

    console.log('Done! Old conversations cleared.');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearDemoConversations();