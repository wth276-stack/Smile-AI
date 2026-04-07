import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './client';
import { toPrismaJson } from './json';

interface V2BookingSlots {
  serviceName?: string | null;
  serviceDisplayName?: string | null;
  date?: string | null;
  time?: string | null;
  customerName?: string | null;
  phone?: string | null;
}

function buildIdempotencyKey(phone: string, serviceName: string, date: string, time: string): string {
  const raw = `${phone}|${serviceName}|${date}|${time}`;
  return createHash('sha256').update(raw).digest('hex');
}

function parseDuration(duration: string | null | undefined): number {
  if (!duration) return 60;
  const match = duration.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 60;
}

export async function submitV2Booking(slots: V2BookingSlots, tenantId: string) {
  const { serviceName, serviceDisplayName, date, time, customerName, phone } = slots;

  if (!phone) throw new Error('Phone is required to create a booking');
  if (!serviceName && !serviceDisplayName) throw new Error('Service name is required');
  if (!date || !time) throw new Error('Date and time are required');

  const svcName = serviceDisplayName ?? serviceName!;
  const startTime = new Date(`${date}T${time}:00`);
  if (isNaN(startTime.getTime())) throw new Error(`Invalid date/time: ${date} ${time}`);

  let durationMinutes = 60;
  try {
    const kbDoc = await prisma.knowledgeDocument.findFirst({
      where: { tenantId, title: { contains: svcName, mode: 'insensitive' } },
      select: { duration: true },
    });
    if (kbDoc?.duration) {
      durationMinutes = parseDuration(kbDoc.duration);
    }
  } catch {
    // KB lookup failed, use default duration
  }

  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);
  const idempotencyKey = buildIdempotencyKey(phone, svcName, date, time);

  let contact = await prisma.contact.findFirst({
    where: { tenantId, phone },
  });

  if (contact) {
    if (customerName && contact.name !== customerName) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: { name: customerName },
      });
    }
  } else {
    contact = await prisma.contact.create({
      data: {
        tenantId,
        phone,
        name: customerName ?? null,
      },
    });
  }

  const booking = await prisma.booking.create({
    data: {
      tenantId,
      contactId: contact.id,
      serviceName: svcName,
      startTime,
      endTime,
      status: 'CONFIRMED',
      idempotencyKey,
    },
  });

  console.log('[v2-helpers] Booking created:', booking.id);
  return booking;
}

export async function getV2ConversationState(
  whatsappId: string,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const conversation = await prisma.conversation.findFirst({
    where: { tenantId, externalId: whatsappId },
    select: { metadata: true },
  });

  if (!conversation?.metadata) return {};
  const meta = conversation.metadata as Record<string, unknown>;
  if (typeof meta.bookingState === 'string') {
    try { return JSON.parse(meta.bookingState); } catch { return {}; }
  }
  return (meta.bookingState as Record<string, unknown>) ?? {};
}

export async function saveV2ConversationState(
  whatsappId: string,
  tenantId: string,
  bookingState: Prisma.InputJsonValue,
): Promise<void> {
  const existing = await prisma.conversation.findFirst({
    where: { tenantId, externalId: whatsappId },
    select: { id: true, metadata: true },
  });

  const mergedMeta: any = {
    ...((existing?.metadata as any) ?? {}),
    bookingState: bookingState as any,
  };

  if (existing) {
    await prisma.conversation.update({
      where: { id: existing.id },
      data: {
        metadata: mergedMeta,
      },
    });
  } else {
    const contact = await prisma.contact.create({
      data: { tenantId, externalIds: { whatsapp: whatsappId } },
    });
    await prisma.conversation.create({
      data: {
        tenantId,
        contactId: contact.id,
        channel: 'WEBCHAT',
        externalId: whatsappId,
        metadata: mergedMeta,
      },
    });
  }
}

export async function getBookingsForPhone(
  phone: string,
  tenantId: string,
): Promise<Array<{
  id: string;
  serviceName: string;
  startTime: Date;
  endTime: Date | null;
  status: string;
}>> {
  const contact = await prisma.contact.findFirst({
    where: { tenantId, phone },
    select: { id: true },
  });
  if (!contact) return [];

  return prisma.booking.findMany({
    where: {
      tenantId,
      contactId: contact.id,
      status: { in: ['CONFIRMED', 'PENDING'] },
      startTime: { gte: new Date() },
    },
    orderBy: { startTime: 'asc' },
    select: { id: true, serviceName: true, startTime: true, endTime: true, status: true },
  });
}

export async function modifyBooking(
  bookingId: string,
  tenantId: string,
  updates: { date?: string; time?: string },
): Promise<{ id: string; serviceName: string; startTime: Date; endTime: Date | null; status: string }> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tenantId },
  });
  if (!booking) throw new Error(`Booking ${bookingId} not found`);

  const durationMs =
    booking.endTime != null
      ? booking.endTime.getTime() - booking.startTime.getTime()
      : 60 * 60_000;

  const currentDate = booking.startTime.toISOString().split('T')[0];
  const currentTime = booking.startTime.toTimeString().slice(0, 5);

  const newDate = updates.date ?? currentDate;
  const newTime = updates.time ?? currentTime;
  const newStart = new Date(`${newDate}T${newTime}:00`);
  if (isNaN(newStart.getTime())) throw new Error(`Invalid date/time: ${newDate} ${newTime}`);
  const newEnd = new Date(newStart.getTime() + durationMs);

  return prisma.booking.update({
    where: { id: bookingId },
    data: { startTime: newStart, endTime: newEnd },
    select: { id: true, serviceName: true, startTime: true, endTime: true, status: true },
  });
}

export async function cancelBooking(
  bookingId: string,
  tenantId: string,
): Promise<{ id: string; serviceName: string; status: string }> {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tenantId },
  });
  if (!booking) throw new Error(`Booking ${bookingId} not found`);

  return prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED' },
    select: { id: true, serviceName: true, status: true },
  });
}

/** Shape consumed by the AI engine as `KnowledgeChunk` for SERVICE documents. */
export type ActiveServiceKnowledgeChunk = {
  documentId: string;
  title: string;
  content: string;
  score: number;
  price: string | null;
  discountPrice: string | null;
  effect: string | null;
  suitable: string | null;
  unsuitable: string | null;
  precaution: string | null;
  duration: string | null;
  aliases: string[];
  steps: string[];
  faqItems: Array<{ question: string; answer: string }> | null;
};

export async function getActiveServices(tenantId: string): Promise<ActiveServiceKnowledgeChunk[]> {
  const docs = await prisma.knowledgeDocument.findMany({
    where: { tenantId, docType: 'SERVICE', isActive: true },
    orderBy: { title: 'asc' },
  });
  return docs.map((d) => ({
    documentId: d.id,
    title: d.title,
    content: d.content,
    score: 1.0,
    price: d.price,
    discountPrice: d.discountPrice,
    effect: d.effect,
    suitable: d.suitable,
    unsuitable: d.unsuitable,
    precaution: d.precaution,
    duration: d.duration,
    aliases: d.aliases,
    steps: d.steps,
    faqItems: d.faqItems as Array<{ question: string; answer: string }> | null,
  }));
}

export async function getTenantSettings(tenantId: string): Promise<Record<string, unknown>> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  return (tenant?.settings as Record<string, unknown>) ?? {};
}
