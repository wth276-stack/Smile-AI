import { prisma } from './client';
import { toPrismaJson } from './json';

const MAX_MESSAGES = 20;

export async function findOrCreateWebchatConversation(
  sessionId: string,
  tenantId: string,
) {
  const existing = await prisma.conversation.findFirst({
    where: { externalId: sessionId, channel: 'WEBCHAT', status: 'OPEN' },
  });
  if (existing) return existing;

  const contact = await prisma.contact.create({
    data: { tenantId, name: 'Webchat User' },
  });

  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      contactId: contact.id,
      channel: 'WEBCHAT',
      externalId: sessionId,
      metadata: {},
    },
  });

  console.log('[conversation-helpers] Created conversation:', conversation.id, 'for session:', sessionId);
  return conversation;
}

export async function loadConversationHistory(
  conversationId: string,
  limit: number = MAX_MESSAGES,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { sender: true, content: true },
  });

  return messages.map((m) => ({
    role: (m.sender === 'CUSTOMER' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }));
}

export async function saveMessages(
  conversationId: string,
  userContent: string,
  aiContent: string,
  rawLlmJson?: unknown,
) {
  const now = new Date();

  await prisma.message.createMany({
    data: [
      {
        conversationId,
        sender: 'CUSTOMER',
        content: userContent,
        createdAt: now,
      },
      {
        conversationId,
        sender: 'AI',
        content: aiContent,
        metadata: rawLlmJson ? { rawLlmJson } : {},
        createdAt: new Date(now.getTime() + 1),
      },
    ],
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}

export async function getBookingDraft(
  conversationId: string,
): Promise<Record<string, unknown> | null> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { metadata: true },
  });
  if (!conv?.metadata) return null;
  const meta = conv.metadata as Record<string, unknown>;
  return (meta.bookingDraft as Record<string, unknown>) ?? null;
}

export async function updateBookingDraft(
  conversationId: string,
  draft: Record<string, unknown>,
) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { metadata: true },
  });

  const existingMeta = (conv?.metadata as Record<string, unknown>) ?? {};

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      metadata: toPrismaJson({ ...existingMeta, bookingDraft: draft }),
    },
  });
}

export async function resetConversation(conversationId: string) {
  await prisma.message.deleteMany({ where: { conversationId } });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { metadata: {}, status: 'OPEN' },
  });
  console.log('[conversation-helpers] Reset conversation:', conversationId);
}

export async function closeConversation(conversationId: string) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'CLOSED', updatedAt: new Date() },
  });
  console.log('[conversation-helpers] Closed conversation:', conversationId);
}
