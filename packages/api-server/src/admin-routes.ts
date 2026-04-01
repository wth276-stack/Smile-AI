import jwt from 'jsonwebtoken';
import { Router, type NextFunction, type Request, type Response, json } from 'express';
import { prisma } from '../../database/src/client';
import {
  getBusinessHours,
  updateBusinessHours,
  generateTimeSlots,
  getAvailableSlots,
} from '../../database/src/business-hours-helpers';

export const adminRouter = Router();
adminRouter.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  next();
});
adminRouter.use(json());

adminRouter.post('/login', (req, res) => {
  const { password } = req.body ?? {};
  if (password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  const token = jwt.sign({ role: 'admin' }, secret, { expiresIn: '24h' });
  res.json({ token });
});

function authenticateAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'Server misconfigured' });
      return;
    }
    jwt.verify(token, secret);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

adminRouter.get('/ping', (_req, res) => {
  res.json({ pong: true });
});

// ── GET /stats ──

adminRouter.get('/stats', authenticateAdmin, async (_req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);

    const [
      todayBookings,
      upcomingBookings,
      completedBookings,
      cancelledBookings,
      totalContacts,
      recentBookings,
      popularRaw,
    ] = await Promise.all([
      prisma.booking.count({
        where: { startTime: { gte: todayStart, lt: todayEnd } },
      }),
      prisma.booking.count({
        where: { status: 'CONFIRMED', startTime: { gt: now } },
      }),
      prisma.booking.count({ where: { status: 'COMPLETED' } }),
      prisma.booking.count({ where: { status: 'CANCELLED' } }),
      prisma.contact.count(),
      prisma.booking.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { contact: { select: { id: true, name: true, phone: true, email: true } } },
      }),
      prisma.booking.groupBy({
        by: ['serviceName'],
        _count: { serviceName: true },
        orderBy: { _count: { serviceName: 'desc' } },
        take: 5,
      }),
    ]);

    const popularServices = popularRaw.map((r) => ({
      serviceName: r.serviceName,
      count: r._count.serviceName,
    }));

    res.json({
      todayBookings,
      upcomingBookings,
      completedBookings,
      cancelledBookings,
      totalContacts,
      recentBookings,
      popularServices,
    });
  } catch (err) {
    console.error('[admin] /stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── GET /bookings ──

adminRouter.get('/bookings', authenticateAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const date = req.query.date as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (date) {
      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      where.startTime = { gte: dayStart, lt: dayEnd };
    }

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: { contact: { select: { id: true, name: true, phone: true, email: true } } },
        orderBy: { startTime: 'desc' },
        skip,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);

    res.json({
      bookings,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('[admin] /bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// ── GET /bookings/:id ──

adminRouter.get('/bookings/:id', authenticateAdmin, async (req, res) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: { contact: { select: { id: true, name: true, phone: true, email: true } } },
    });
    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    res.json(booking);
  } catch (err) {
    console.error('[admin] /bookings/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

// ── PATCH /bookings/:id ──

const VALID_STATUSES = new Set(['CONFIRMED', 'CANCELLED', 'COMPLETED', 'PENDING', 'NO_SHOW']);

adminRouter.patch('/bookings/:id', authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.body ?? {};
    if (!status || !VALID_STATUSES.has(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` });
      return;
    }

    const existing = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    const booking = await prisma.booking.update({
      where: { id: req.params.id },
      data: { status },
      include: { contact: { select: { id: true, name: true, phone: true, email: true } } },
    });
    res.json(booking);
  } catch (err) {
    console.error('[admin] PATCH /bookings/:id error:', err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// ── GET /contacts ──

adminRouter.get('/contacts', authenticateAdmin, async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: { _count: { select: { bookings: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.contact.count({ where }),
    ]);

    res.json({
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        tags: c.tags,
        createdAt: c.createdAt,
        bookingCount: c._count.bookings,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('[admin] /contacts error:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// ── GET /export/bookings.csv ──

adminRouter.get('/export/bookings.csv', authenticateAdmin, async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.gte = new Date(`${from}T00:00:00`);
      if (to) range.lt = new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000);
      where.startTime = range;
    }

    const bookings = await prisma.booking.findMany({
      where,
      include: { contact: { select: { name: true, phone: true, email: true } } },
      orderBy: { startTime: 'desc' },
      take: 10000,
    });

    const header = 'ID,Service,Status,Start,End,Customer,Phone,Email,Created';
    const rows = bookings.map((b) => {
      const fields = [
        b.id,
        b.serviceName,
        b.status,
        b.startTime.toISOString(),
        b.endTime ? b.endTime.toISOString() : '',
        b.contact?.name ?? '',
        b.contact?.phone ?? '',
        b.contact?.email ?? '',
        b.createdAt.toISOString(),
      ];
      return fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('[admin] /export/bookings.csv error:', err);
    res.status(500).json({ error: 'Failed to export bookings' });
  }
});

// ── GET /export/contacts.csv ──

adminRouter.get('/export/contacts.csv', authenticateAdmin, async (req, res) => {
  try {
    const contacts = await prisma.contact.findMany({
      include: { _count: { select: { bookings: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const header = 'ID,Name,Phone,Email,Tags,Bookings,Created';
    const rows = contacts.map((c) => {
      const fields = [
        c.id,
        c.name ?? '',
        c.phone ?? '',
        c.email ?? '',
        Array.isArray(c.tags) ? (c.tags as string[]).join('; ') : '',
        String(c._count.bookings),
        c.createdAt.toISOString(),
      ];
      return fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('[admin] /export/contacts.csv error:', err);
    res.status(500).json({ error: 'Failed to export contacts' });
  }
});

// ── GET /services ──

adminRouter.get('/services', authenticateAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const skip = (page - 1) * limit;

    const where = { tenantId: 'demo-tenant', docType: 'SERVICE' as const };

    const [services, total] = await Promise.all([
      prisma.knowledgeDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.knowledgeDocument.count({ where }),
    ]);

    res.json({
      services,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('[admin] /services error:', err);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// ── GET /services/:id ──

adminRouter.get('/services/:id', authenticateAdmin, async (req, res) => {
  try {
    const service = await prisma.knowledgeDocument.findUnique({
      where: { id: req.params.id },
    });
    if (!service || service.tenantId !== 'demo-tenant') {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.json(service);
  } catch (err) {
    console.error('[admin] /services/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch service' });
  }
});

// ── POST /services ──

adminRouter.post('/services', authenticateAdmin, async (req, res) => {
  try {
    const {
      title, content, effect, suitable, unsuitable, precaution,
      duration, price, discountPrice, aliases, steps, faqItems, category,
    } = req.body ?? {};

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const service = await prisma.knowledgeDocument.create({
      data: {
        tenantId: 'demo-tenant',
        docType: 'SERVICE',
        title: title.trim(),
        content: content?.trim() || title.trim(),
        effect: effect?.trim() || null,
        suitable: suitable?.trim() || null,
        unsuitable: unsuitable?.trim() || null,
        precaution: precaution?.trim() || null,
        duration: duration?.trim() || null,
        price: price?.trim() || null,
        discountPrice: discountPrice?.trim() || null,
        aliases: Array.isArray(aliases) ? aliases : [],
        steps: Array.isArray(steps) ? steps : [],
        faqItems: faqItems ?? null,
        category: category?.trim() || null,
      },
    });

    res.status(201).json(service);
  } catch (err) {
    console.error('[admin] POST /services error:', err);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// ── PUT /services/:id ──

adminRouter.put('/services/:id', authenticateAdmin, async (req, res) => {
  try {
    const existing = await prisma.knowledgeDocument.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.tenantId !== 'demo-tenant') {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    const {
      title, content, effect, suitable, unsuitable, precaution,
      duration, price, discountPrice, aliases, steps, faqItems, category, isActive,
    } = req.body ?? {};

    const service = await prisma.knowledgeDocument.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(content !== undefined && { content: content.trim() }),
        ...(effect !== undefined && { effect: effect?.trim() || null }),
        ...(suitable !== undefined && { suitable: suitable?.trim() || null }),
        ...(unsuitable !== undefined && { unsuitable: unsuitable?.trim() || null }),
        ...(precaution !== undefined && { precaution: precaution?.trim() || null }),
        ...(duration !== undefined && { duration: duration?.trim() || null }),
        ...(price !== undefined && { price: price?.trim() || null }),
        ...(discountPrice !== undefined && { discountPrice: discountPrice?.trim() || null }),
        ...(aliases !== undefined && { aliases: Array.isArray(aliases) ? aliases : [] }),
        ...(steps !== undefined && { steps: Array.isArray(steps) ? steps : [] }),
        ...(faqItems !== undefined && { faqItems: faqItems ?? null }),
        ...(category !== undefined && { category: category?.trim() || null }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    res.json(service);
  } catch (err) {
    console.error('[admin] PUT /services/:id error:', err);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

// ── DELETE /services/:id ──

adminRouter.delete('/services/:id', authenticateAdmin, async (req, res) => {
  try {
    const existing = await prisma.knowledgeDocument.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.tenantId !== 'demo-tenant') {
      res.status(404).json({ error: 'Service not found' });
      return;
    }

    await prisma.knowledgeDocument.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    console.error('[admin] DELETE /services/:id error:', err);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// ── GET /business-hours ──

adminRouter.get('/business-hours', authenticateAdmin, async (_req, res) => {
  try {
    const hours = await getBusinessHours('demo-tenant');
    res.json(hours);
  } catch (err) {
    console.error('[admin] /business-hours error:', err);
    res.status(500).json({ error: 'Failed to get business hours' });
  }
});

// ── PUT /business-hours ──

adminRouter.put('/business-hours', authenticateAdmin, async (req, res) => {
  try {
    const { hours } = req.body;
    const updated = await updateBusinessHours('demo-tenant', hours);
    const slotCount = await generateTimeSlots('demo-tenant', 14);
    res.json({ success: true, updated: updated.length, slotsGenerated: slotCount });
  } catch (err) {
    console.error('[admin] PUT /business-hours error:', err);
    res.status(500).json({ error: 'Failed to update business hours' });
  }
});

// ── POST /generate-slots ──

adminRouter.post('/generate-slots', authenticateAdmin, async (req, res) => {
  try {
    const daysAhead = req.body.daysAhead || 14;
    const count = await generateTimeSlots('demo-tenant', daysAhead);
    res.json({ success: true, slotsGenerated: count });
  } catch (err) {
    console.error('[admin] /generate-slots error:', err);
    res.status(500).json({ error: 'Failed to generate slots' });
  }
});

// ── GET /available-slots ──

adminRouter.get('/available-slots', authenticateAdmin, async (req, res) => {
  try {
    const date = req.query.date as string;
    if (!date) {
      res.status(400).json({ error: 'date query parameter is required' });
      return;
    }
    const slots = await getAvailableSlots('demo-tenant', date);
    res.json(slots);
  } catch (err) {
    console.error('[admin] /available-slots error:', err);
    res.status(500).json({ error: 'Failed to get available slots' });
  }
});
