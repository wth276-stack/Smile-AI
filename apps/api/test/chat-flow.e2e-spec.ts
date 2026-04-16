/**
 * Real DB + HTTP integration for chat → ai-engine → persistence.
 *
 * Requires PostgreSQL with schema migrated (see packages/database/prisma/migrations).
 *
 *   cd apps/api && set RUN_CHAT_E2E=1 && pnpm exec jest --config jest.integration.config.js --runInBand
 *
 * Or PowerShell: $env:RUN_CHAT_E2E='1'; pnpm exec jest --config jest.integration.config.js --runInBand
 *
 * Create-booking contract (V2): COLLECT → CONFIRM (summary) → user affirms → SUBMIT_BOOKING → CREATE_BOOKING.
 * Cancel-booking contract (V2): phone lookup → identify booking → CONFIRM cancel → user affirms → CANCEL_BOOKING (DB CANCELLED).
 * Tests do not assume a single user message immediately persists a booking.
 *
 * Follow-ups tracked outside this file (separate tickets, not fixed here):
 * 1) Assistant reply text vs newSlots inconsistency (e.g. asks for name when already in newSlots)
 * 2) serviceDisplayName / KB title alias mismatch (e.g. 眼部護理 vs Eye Treatment)
 */

import type { AddressInfo } from 'net';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter';

const RUN = process.env.RUN_CHAT_E2E === '1' || process.env.RUN_CHAT_E2E === 'true';

async function postJson(app: INestApplication, path: string, body: unknown) {
  const server = app.getHttpServer();
  const addr = server.address() as AddressInfo;
  const port = addr.port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, json };
}

/** Multi-turn: intent → slots → affirmation — aligns with CONFIRM → SUBMIT → CREATE. */
async function postEyeTreatmentBookingFlow(
  app: INestApplication,
  tenantId: string,
  ext: string,
  detailLine: string,
) {
  await postJson(app, '/api/chat/message', {
    tenantId,
    channel: 'WEBCHAT',
    externalContactId: ext,
    contactName: 'E2E',
    message: '我想預約 Eye Treatment',
  });
  await postJson(app, '/api/chat/message', {
    tenantId,
    channel: 'WEBCHAT',
    externalContactId: ext,
    message: detailLine,
  });
  return postJson(app, '/api/chat/message', {
    tenantId,
    channel: 'WEBCHAT',
    externalContactId: ext,
    message: '好',
  });
}

(RUN ? describe : describe.skip)('Chat flow E2E (RUN_CHAT_E2E=1)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let tenantId: string | undefined;
  const extPrefix = `e2e-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    prisma = app.get(PrismaService);
    await app.init();
    await app.listen(0);

    const tenant = await prisma!.tenant.create({
      data: { name: 'E2E Chat Tenant', plan: 'STARTER', settings: {} },
    });
    tenantId = tenant.id;

    await prisma!.knowledgeDocument.createMany({
      data: [
        {
          tenantId,
          title: 'Eye Treatment',
          content:
            'Eye Treatment 眼部護理\n功效：減淡黑眼圈\n時長：約45分鐘\n價錢：HKD 680',
          isActive: true,
        },
        {
          tenantId,
          title: 'HIFU 緊緻',
          content: 'HIFU 緊緻\n功效：拉提\n價錢：HKD 1200',
          isActive: true,
        },
      ],
    });
  });

  afterAll(async () => {
    try {
      if (prisma && tenantId) {
        await prisma.message.deleteMany({ where: { conversation: { tenantId } } });
        await prisma.aiRun.deleteMany({ where: { tenantId } });
        await prisma.booking.deleteMany({ where: { tenantId } });
        await prisma.conversation.deleteMany({ where: { tenantId } });
        await prisma.contact.deleteMany({ where: { tenantId } });
        await prisma.knowledgeDocument.deleteMany({ where: { tenantId } });
        await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
      }
    } catch {
      /* setup may have failed before tenantId existed */
    }
    if (app) await app.close().catch(() => undefined);
  });

  it('S1 inquiry: HTTP 201/200, AiRun SUCCESS, PRODUCT_INQUIRY', async () => {
    const ext = `${extPrefix}-s1`;
    const { status, json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      contactName: 'E2E',
      message: '我想了解 Eye Treatment',
    });
    expect([200, 201]).toContain(status);
    const j = json as any;
    expect(j.reply).toBeTruthy();
    expect(j.sideEffectFailures).toEqual([]);

    const conv = await prisma!.conversation.findFirst({
      where: { tenantId, externalId: ext },
      include: { messages: true },
    });
    expect(conv?.messages.length).toBe(2);

    const run = await prisma!.aiRun.findFirst({
      where: { conversationId: conv!.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(run?.status).toBe('SUCCESS');
    const sig = run?.signals as any;
    expect(sig.intents).toContain('PRODUCT_INQUIRY');
  });

  it('S2 price: PRICE_INQUIRY, HKD in reply', async () => {
    const ext = `${extPrefix}-s2`;
    const { status, json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: 'Eye Treatment 幾錢？',
    });
    expect([200, 201]).toContain(status);
    const j = json as any;
    expect(j.reply).toMatch(/680/);
    const conv = await prisma!.conversation.findFirst({ where: { tenantId, externalId: ext } });
    const run = await prisma!.aiRun.findFirst({
      where: { conversationId: conv!.id },
      orderBy: { createdAt: 'desc' },
    });
    expect((run?.signals as any).intents).toContain('PRICE_INQUIRY');
  });

  it('S3 full booking: collect → affirm → CREATE_BOOKING + one row', async () => {
    const ext = `${extPrefix}-s3`;
    await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      contactName: 'E2E',
      message: '我想預約 Eye Treatment',
    });
    await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '明天晚上7點，我叫陳大文電話91234567',
    });

    const contactMid = await prisma!.contact.findFirst({
      where: { tenantId, externalIds: { path: ['webchat'], equals: ext } },
    });
    expect(
      await prisma!.booking.count({
        where: { tenantId, contactId: contactMid!.id },
      }),
    ).toBe(0);

    const { json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '好',
    });
    const j = json as any;
    expect(j.sideEffectFailures).toEqual([]);
    expect((j.sideEffects ?? []).some((e: { type: string }) => e.type === 'CREATE_BOOKING')).toBe(true);

    const contact = await prisma!.contact.findFirst({
      where: { tenantId, externalIds: { path: ['webchat'], equals: ext } },
    });
    const n = await prisma!.booking.count({
      where: { tenantId, contactId: contact!.id },
    });
    expect(n).toBe(1);
    expect(contact?.name).toBe('陳大文');
    expect(contact?.phone).toBe('91234567');

    const conv = await prisma!.conversation.findFirst({ where: { tenantId, externalId: ext } });
    const run = await prisma!.aiRun.findFirst({
      where: { conversationId: conv!.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(run?.status).toBe('SUCCESS');
    expect((run?.signals as any).action).toBe('REQUEST_BOOKING');
  });

  it('S4 draft follow-up: time-only second message', async () => {
    const ext = `${extPrefix}-s4`;
    await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      contactName: 'E2E',
      message: '我想預約 Eye Treatment',
    });
    const { json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '明天晚上7點',
    });
    const j = json as any;
    expect(j.reply).toBeTruthy();
    const conv = await prisma!.conversation.findFirst({ where: { tenantId, externalId: ext } });
    const runs = await prisma!.aiRun.findMany({
      where: { conversationId: conv!.id },
      orderBy: { createdAt: 'asc' },
    });
    const last = runs[runs.length - 1];
    const sig = last.signals as any;
    expect(
      sig.intents?.includes('BOOKING_REQUEST') ||
        (typeof sig.bookingDraft?.time === 'string' && sig.bookingDraft.time.trim().length > 0),
    ).toBe(true);
  });

  it(
    'S5 duplicate affirm after create: idempotent — still one booking row (3 runs)',
    async () => {
      for (let run = 0; run < 3; run++) {
        const ext = `${extPrefix}-s5-r${run}`;
        await postEyeTreatmentBookingFlow(
          app!,
          tenantId!,
          ext,
          '明天晚上7點，我叫陳大文電話91234567',
        );
        await postJson(app!, '/api/chat/message', {
          tenantId,
          channel: 'WEBCHAT',
          externalContactId: ext,
          message: '好',
        });

        const contact = await prisma!.contact.findFirst({
          where: { tenantId, externalIds: { path: ['webchat'], equals: ext } },
        });
        const n = await prisma!.booking.count({
          where: { tenantId, contactId: contact!.id },
        });
        expect(n).toBe(1);
      }
    },
    360_000,
  );

  it('S6 CREATE_BOOKING failure: ERROR run, sideEffectFailures, no extra booking', async () => {
    const ext = `${extPrefix}-s6`;
    const moduleFail: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BookingsService)
      .useValue({
        findAll: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
        findById: async () => {
          throw new Error('not in e2e');
        },
        create: async () => {
          throw new Error('not in e2e');
        },
        upsertFromAiSideEffect: async () => {
          throw new Error('simulated_create_failure');
        },
        update: async () => {
          throw new Error('not in e2e');
        },
      })
      .compile();

    const appFail = moduleFail.createNestApplication();
    appFail.setGlobalPrefix('api');
    appFail.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    appFail.useGlobalFilters(new GlobalExceptionFilter());
    const prismaFail = appFail.get(PrismaService);
    await appFail.init();
    await appFail.listen(0);

    const before = await prismaFail.booking.count({ where: { tenantId } });
    await postJson(appFail, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      contactName: 'E2E',
      message: '我想預約 Eye Treatment',
    });
    await postJson(appFail, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '明天晚上7點，我叫陳大文電話99887766',
    });
    const { json } = await postJson(appFail, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '好',
    });
    const j = json as any;
    expect(j.sideEffectFailures?.length).toBeGreaterThanOrEqual(1);
    expect(j.sideEffectFailures[0].effect.type).toBe('CREATE_BOOKING');
    expect(j.sideEffectFailures?.[0]?.message).toContain('simulated_create_failure');

    const after = await prismaFail.booking.count({ where: { tenantId } });
    expect(after).toBe(before);

    const conv = await prismaFail.conversation.findFirst({
      where: { tenantId, externalId: ext },
    });
    const run = await prismaFail.aiRun.findFirst({
      where: { conversationId: conv!.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(run?.status).toBe('ERROR');
    expect(run?.error).toMatch(/CREATE_BOOKING|simulated/);
    expect(run?.sideEffectFailures).toBeTruthy();
    const sig = run?.signals as any;
    expect(sig._integration?.bookingPersisted).toBe(false);
    expect(sig.bookingDraft?.date).toBeNull();
    expect(sig.bookingDraft?.time).toBeNull();

    await prismaFail.message.deleteMany({ where: { conversationId: conv!.id } });
    await prismaFail.aiRun.deleteMany({ where: { conversationId: conv!.id } });
    await prismaFail.conversation.delete({ where: { id: conv!.id } });
    await prismaFail.contact.deleteMany({
      where: { tenantId, externalIds: { path: ['webchat'], equals: ext } },
    });
    await appFail.close();
  });

  it('S7 cross-service price with draft: HIFU price not Eye', async () => {
    const ext = `${extPrefix}-s7`;
    await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '我想了解 Eye Treatment',
    });
    const { json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: 'HIFU 幾錢？',
    });
    const j = json as any;
    expect(j.reply).toMatch(/1200/);
    expect(j.reply).not.toMatch(/680/);
  });

  it('S8 name-like input does not commit service', async () => {
    const ext = `${extPrefix}-s8`;
    const { json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '我叫 HIFU，電話 91234567',
    });
    const j = json as any;
    expect(j.reply).toBeTruthy();
    const conv = await prisma!.conversation.findFirst({ where: { tenantId, externalId: ext } });
    const run = await prisma!.aiRun.findFirst({
      where: { conversationId: conv!.id },
      orderBy: { createdAt: 'desc' },
    });
    expect((run?.signals as any).bookingDraft?.serviceName).toBeFalsy();
  });

  it('S9 low-confidence inquiry does not dump broad catalog', async () => {
    const ext = `${extPrefix}-s9`;
    const { json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '有冇啱我嘅療程呀',
    });
    const j = json as any;
    expect(j.reply).not.toMatch(/Eye Treatment/);
    expect(j.reply).not.toMatch(/HIFU/);
  });

  it('S10 contract: one-shot full booking info without affirm — no CREATE_BOOKING, no row', async () => {
    const ext = `${extPrefix}-s10`;
    const { json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      contactName: 'E2E',
      message:
        '我想預約 Eye Treatment，明天晚上7點，我叫陳大文電話91234567',
    });
    const j = json as any;
    expect((j.sideEffects ?? []).some((e: { type: string }) => e.type === 'CREATE_BOOKING')).toBe(false);
    expect(j.sideEffectFailures ?? []).toEqual([]);

    const contact = await prisma!.contact.findFirst({
      where: { tenantId, externalIds: { path: ['webchat'], equals: ext } },
    });
    expect(
      await prisma!.booking.count({
        where: { tenantId, contactId: contact!.id },
      }),
    ).toBe(0);

    const conv = await prisma!.conversation.findFirst({ where: { tenantId, externalId: ext } });
    const lastAi = await prisma!.message.findFirst({
      where: { conversationId: conv!.id, sender: 'AI' },
      orderBy: { createdAt: 'desc' },
    });
    const meta = lastAi?.metadata as { rawLlmJson?: string } | null;
    expect(meta?.rawLlmJson).toBeTruthy();
    const parsed = JSON.parse(meta!.rawLlmJson!) as { action?: string };
    expect(['COLLECT_BOOKING', 'CONFIRM_BOOKING']).toContain(parsed.action);
  });

  it('C1 single booking cancel: confirm → 確認取消 → CANCEL_BOOKING + DB CANCELLED', async () => {
    const ext = `${extPrefix}-c1`;
    const phone = '69885678';
    const start = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const contact = await prisma!.contact.create({
      data: {
        tenantId: tenantId!,
        name: 'Cancel C1',
        phone,
        externalIds: { webchat: ext },
      },
    });
    const booking = await prisma!.booking.create({
      data: {
        tenantId: tenantId!,
        contactId: contact.id,
        status: 'CONFIRMED',
        serviceName: 'Eye Treatment',
        startTime: start,
        endTime: new Date(start.getTime() + 45 * 60 * 1000),
        phone,
        customerName: '陳大文',
      },
    });

    const { json: j1 } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      contactName: 'E2E',
      message: '我想取消預約，我電話係69885678',
    });
    const j1o = j1 as any;
    expect((j1o.sideEffects ?? []).some((e: { type: string }) => e.type === 'CANCEL_BOOKING')).toBe(
      false,
    );
    expect(
      await prisma!.booking.findUnique({ where: { id: booking.id } }),
    ).toMatchObject({ status: 'CONFIRMED' });

    const { json: j2 } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '確認取消',
    });
    const j2o = j2 as any;
    expect((j2o.sideEffects ?? []).some((e: { type: string }) => e.type === 'CANCEL_BOOKING')).toBe(
      true,
    );
    expect((j2o.sideEffects ?? []).some((e: { type: string }) => e.type === 'CREATE_BOOKING')).toBe(
      false,
    );
    expect(
      await prisma!.booking.findUnique({ where: { id: booking.id } }),
    ).toMatchObject({ status: 'CANCELLED' });
    expect(await prisma!.booking.count({ where: { tenantId, contactId: contact.id } })).toBe(1);
  });

  it('C2 multiple upcoming bookings: list choices, no immediate CANCEL_BOOKING', async () => {
    const ext = `${extPrefix}-c2`;
    const phone = '61234567';
    const tA = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const tB = new Date(tA.getTime() + 6 * 60 * 60 * 1000);
    const contact = await prisma!.contact.create({
      data: {
        tenantId: tenantId!,
        name: 'Cancel C2',
        phone,
        externalIds: { webchat: ext },
      },
    });
    await prisma!.booking.createMany({
      data: [
        {
          tenantId: tenantId!,
          contactId: contact.id,
          status: 'CONFIRMED',
          serviceName: 'Eye Treatment',
          startTime: tA,
          endTime: new Date(tA.getTime() + 45 * 60 * 1000),
          phone,
          customerName: '甲',
        },
        {
          tenantId: tenantId!,
          contactId: contact.id,
          status: 'CONFIRMED',
          serviceName: 'HIFU 緊緻',
          startTime: tB,
          endTime: new Date(tB.getTime() + 60 * 60 * 1000),
          phone,
          customerName: '乙',
        },
      ],
    });

    const { json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      contactName: 'E2E',
      message: '我想取消預約，我電話係61234567',
    });
    const j = json as any;
    expect((j.sideEffects ?? []).some((e: { type: string }) => e.type === 'CANCEL_BOOKING')).toBe(
      false,
    );
    expect(j.reply).toMatch(/1\.|2\.|邊|哪|選|張|個|預約/s);
    const open = await prisma!.booking.count({
      where: { tenantId, contactId: contact.id, status: { not: 'CANCELLED' } },
    });
    expect(open).toBe(2);
  });

  it('C3 after cancel confirmation: 我唔取消住 — no cancel, DB unchanged', async () => {
    const ext = `${extPrefix}-c3`;
    const phone = '69881234';
    const start = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    const contact = await prisma!.contact.create({
      data: {
        tenantId: tenantId!,
        name: 'Cancel C3',
        phone,
        externalIds: { webchat: ext },
      },
    });
    const booking = await prisma!.booking.create({
      data: {
        tenantId: tenantId!,
        contactId: contact.id,
        status: 'CONFIRMED',
        serviceName: 'Eye Treatment',
        startTime: start,
        endTime: new Date(start.getTime() + 45 * 60 * 1000),
        phone,
        customerName: '李小明',
      },
    });

    await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      contactName: 'E2E',
      message: '我想取消預約，我電話係69881234',
    });
    const { json: j2 } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '我唔取消住',
    });
    const j2o = j2 as any;
    expect((j2o.sideEffects ?? []).some((e: { type: string }) => e.type === 'CANCEL_BOOKING')).toBe(
      false,
    );
    expect(
      await prisma!.booking.findUnique({ where: { id: booking.id } }),
    ).toMatchObject({ status: 'CONFIRMED' });
  });

  it('C4 cancel affirmation 好 → CANCEL_BOOKING, not CREATE_BOOKING', async () => {
    const ext = `${extPrefix}-c4`;
    const phone = '69889999';
    const start = new Date(Date.now() + 16 * 24 * 60 * 60 * 1000);
    const contact = await prisma!.contact.create({
      data: {
        tenantId: tenantId!,
        name: 'Cancel C4',
        phone,
        externalIds: { webchat: ext },
      },
    });
    const booking = await prisma!.booking.create({
      data: {
        tenantId: tenantId!,
        contactId: contact.id,
        status: 'CONFIRMED',
        serviceName: 'Eye Treatment',
        startTime: start,
        endTime: new Date(start.getTime() + 45 * 60 * 1000),
        phone,
        customerName: '王五',
      },
    });

    await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      contactName: 'E2E',
      message: '我想取消預約，我電話係69889999',
    });
    const { json } = await postJson(app!, '/api/chat/message', {
      tenantId,
      channel: 'WEBCHAT',
      externalContactId: ext,
      message: '好',
    });
    const j = json as any;
    expect((j.sideEffects ?? []).some((e: { type: string }) => e.type === 'CANCEL_BOOKING')).toBe(
      true,
    );
    expect((j.sideEffects ?? []).some((e: { type: string }) => e.type === 'CREATE_BOOKING')).toBe(
      false,
    );
    expect(
      await prisma!.booking.findUnique({ where: { id: booking.id } }),
    ).toMatchObject({ status: 'CANCELLED' });
  });
});
