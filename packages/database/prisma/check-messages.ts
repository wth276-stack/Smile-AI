const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Get latest conversation
  const conv = await prisma.conversation.findFirst({
    where: { tenantId: 'demo-tenant' },
    orderBy: { updatedAt: 'desc' },
    include: { contact: true }
  });

  console.log('=== Latest Conversation ===');
  console.log('ID:', conv?.id);
  console.log('Contact:', conv?.contact?.name);
  console.log('Channel:', conv?.channel);
  console.log('Status:', conv?.status);

  if (!conv) {
    console.log('No conversation found');
    return;
  }

  // Get messages for this conversation
  const messages = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: 'asc' },
    take: 20
  });

  console.log('\n=== Messages ===');
  console.log('Count:', messages.length);
  messages.forEach((m, i) => {
    const content = m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content;
    console.log(`${i + 1}. [${m.sender}] ${content}`);
  });

  // Get latest AiRun for signals
  const aiRun = await prisma.aiRun.findFirst({
    where: { conversationId: conv.id },
    orderBy: { createdAt: 'desc' }
  });

  if (aiRun?.signals) {
    console.log('\n=== Signals ===');
    const signals = aiRun.signals as any;
    console.log('Stage:', signals?.conversationStage);
    console.log('Emotion:', signals?.customerEmotion);
    console.log('Trust:', signals?.customerTrust);
    console.log('Readiness:', signals?.customerReadiness);
    console.log('Mode:', signals?.conversationMode);
    console.log('Strategy:', signals?.strategy);
  }
}

main()
  .catch((e) => console.error('Error:', e))
  .finally(() => prisma.$disconnect());