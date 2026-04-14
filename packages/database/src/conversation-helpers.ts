import { Prisma } from '@prisma/client';
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

/** Booking draft + confirmation flag for V2 engine (webchat / api-server). */
export async function getConversationBookingState(conversationId: string): Promise<{
  bookingDraft: Record<string, unknown> | null;
  confirmationPending: boolean;
}> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { metadata: true },
  });
  if (!conv?.metadata) {
    return { bookingDraft: null, confirmationPending: false };
  }
  const meta = conv.metadata as Record<string, unknown>;
  return {
    bookingDraft: (meta.bookingDraft as Record<string, unknown>) ?? null,
    confirmationPending: !!meta.confirmationPending,
  };
}

export async function getBookingDraft(
  conversationId: string,
): Promise<Record<string, unknown> | null> {
  const { bookingDraft } = await getConversationBookingState(conversationId);
  return bookingDraft;
}

export async function updateBookingDraft(
  conversationId: string,
  draft: Prisma.InputJsonValue | undefined,
  confirmationPending: boolean | undefined,
) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { metadata: true },
  });

  const existingMeta = (conv?.metadata as Record<string, any>) ?? {};

  const metaToSave = {
    ...existingMeta,
    ...(draft !== undefined && { bookingDraft: draft }),
    confirmationPending: !!confirmationPending,
  } as any;

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      metadata: metaToSave,
    },
  });
}

/**
 * Merge partial fields into conversation.metadata without overwriting unrelated keys.
 * Safe for concurrent callers writing different metadata keys.
 */
export async function mergeConversationMetadata(
  conversationId: string,
  patch: Record<string, unknown>,
) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { metadata: true },
  });
  const existing = (conv?.metadata as Record<string, any>) ?? {};
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { metadata: { ...existing, ...patch } },
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
