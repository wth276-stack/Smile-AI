import { prisma } from './client';

const DEFAULT_HOURS = [
  { dayOfWeek: 0, openTime: '10:00', closeTime: '20:00', isClosed: true },
  { dayOfWeek: 1, openTime: '10:00', closeTime: '20:00', isClosed: false },
  { dayOfWeek: 2, openTime: '10:00', closeTime: '20:00', isClosed: false },
  { dayOfWeek: 3, openTime: '10:00', closeTime: '20:00', isClosed: false },
  { dayOfWeek: 4, openTime: '10:00', closeTime: '20:00', isClosed: false },
  { dayOfWeek: 5, openTime: '10:00', closeTime: '20:00', isClosed: false },
  { dayOfWeek: 6, openTime: '10:00', closeTime: '20:00', isClosed: false },
];

const DAY_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export async function getBusinessHours(tenantId: string) {
  let hours = await prisma.businessHours.findMany({
    where: { tenantId },
    orderBy: { dayOfWeek: 'asc' },
  });

  if (hours.length === 0) {
    const now = new Date();
    await prisma.businessHours.createMany({
      data: DEFAULT_HOURS.map((h) => ({ ...h, tenantId, updatedAt: now })),
    });
    hours = await prisma.businessHours.findMany({
      where: { tenantId },
      orderBy: { dayOfWeek: 'asc' },
    });
  }

  return hours;
}

export async function updateBusinessHours(
  tenantId: string,
  updates: Array<{
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
    slotDuration?: number;
  }>,
) {
  const results = [];
  for (const u of updates) {
    const result = await prisma.businessHours.upsert({
      where: {
        tenantId_dayOfWeek: { tenantId, dayOfWeek: u.dayOfWeek },
      },
      update: {
        openTime: u.openTime,
        closeTime: u.closeTime,
        isClosed: u.isClosed,
        slotDuration: u.slotDuration ?? 60,
      },
      create: {
        tenantId,
        dayOfWeek: u.dayOfWeek,
        openTime: u.openTime,
        closeTime: u.closeTime,
        isClosed: u.isClosed,
        slotDuration: u.slotDuration ?? 60,
      },
    });
    results.push(result);
  }
  return results;
}

export async function generateTimeSlots(tenantId: string, daysAhead: number = 14) {
  const hours = await getBusinessHours(tenantId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const slotsToCreate: Array<{
    tenantId: string;
    date: Date;
    startTime: Date;
    endTime: Date;
    isAvailable: boolean;
  }> = [];

  for (let d = 0; d < daysAhead; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);

    const dayOfWeek = date.getDay();
    const dayHours = hours.find((h) => h.dayOfWeek === dayOfWeek);

    if (!dayHours || dayHours.isClosed) continue;

    const [openH, openM] = dayHours.openTime.split(':').map(Number);
    const [closeH, closeM] = dayHours.closeTime.split(':').map(Number);
    const slotMinutes = dayHours.slotDuration || 60;

    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    for (let t = openMinutes; t + slotMinutes <= closeMinutes; t += slotMinutes) {
      const startTime = new Date(date);
      startTime.setHours(Math.floor(t / 60), t % 60, 0, 0);

      const endTime = new Date(date);
      endTime.setHours(Math.floor((t + slotMinutes) / 60), (t + slotMinutes) % 60, 0, 0);

      slotsToCreate.push({
        tenantId,
        date: new Date(date),
        startTime,
        endTime,
        isAvailable: true,
      });
    }
  }

  await prisma.timeSlot.deleteMany({
    where: {
      tenantId,
      date: { gte: today },
      isAvailable: true,
    },
  });

  if (slotsToCreate.length > 0) {
    await prisma.timeSlot.createMany({
      data: slotsToCreate,
      skipDuplicates: true,
    });
  }

  return slotsToCreate.length;
}

export async function getAvailableSlots(tenantId: string, date: string) {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const slots = await prisma.timeSlot.findMany({
    where: {
      tenantId,
      date: { gte: targetDate, lt: nextDay },
      isAvailable: true,
    },
    orderBy: { startTime: 'asc' },
  });

  return slots.map((s) => ({
    id: s.id,
    time: `${String(s.startTime.getHours()).padStart(2, '0')}:${String(s.startTime.getMinutes()).padStart(2, '0')}`,
    endTime: `${String(s.endTime.getHours()).padStart(2, '0')}:${String(s.endTime.getMinutes()).padStart(2, '0')}`,
  }));
}

export async function getBusinessHoursForPrompt(tenantId: string): Promise<string> {
  const hours = await getBusinessHours(tenantId);

  const lines = hours.map((h) => {
    if (h.isClosed) return `${DAY_NAMES[h.dayOfWeek]}：休息`;
    return `${DAY_NAMES[h.dayOfWeek]}：${h.openTime} - ${h.closeTime}`;
  });

  return lines.join('\n');
}
