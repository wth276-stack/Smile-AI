import { BadRequestException } from '@nestjs/common';
import { DemoService } from './demo.service';
import { applyIndustrySeedToTenant, updateBookingDraft } from '@ats/database';

jest.mock('../common/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('@ats/database', () => ({
  applyIndustrySeedToTenant: jest.fn(),
  getDemoTenantIdForIndustryId: jest.fn((industryId: string) =>
    industryId === 'beauty' ? 'demo-tenant' : undefined,
  ),
  getIndustrySeed: jest.fn((industryId: string) =>
    industryId === 'beauty'
      ? { id: 'beauty', displayName: 'Beauty Demo' }
      : undefined,
  ),
  isDemoIndustryTenantId: jest.fn((tenantId: string) => tenantId === 'demo-tenant'),
  updateBookingDraft: jest.fn(),
}));

describe('DemoService', () => {
  const applyIndustrySeedToTenantMock = applyIndustrySeedToTenant as jest.MockedFunction<
    typeof applyIndustrySeedToTenant
  >;
  const updateBookingDraftMock = updateBookingDraft as jest.MockedFunction<typeof updateBookingDraft>;

  function createPrismaMock() {
    return {
      conversation: {
        findFirst: jest.fn(),
      },
      message: {
        deleteMany: jest.fn(),
      },
      aiRun: {
        deleteMany: jest.fn(),
      },
      knowledgeDocument: {
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves KnowledgeDocument rows by default', async () => {
    const prisma = createPrismaMock();
    prisma.knowledgeDocument.count
      .mockResolvedValueOnce(25)
      .mockResolvedValueOnce(36);
    const service = new DemoService(prisma as never);

    const result = await service.resetDemo('beauty');

    expect(applyIndustrySeedToTenantMock).not.toHaveBeenCalled();
    expect(prisma.knowledgeDocument.count).toHaveBeenCalledWith({
      where: { tenantId: 'demo-tenant', isActive: true, docType: 'SERVICE' },
    });
    expect(prisma.knowledgeDocument.count).toHaveBeenCalledWith({
      where: { tenantId: 'demo-tenant', isActive: true },
    });
    expect(result).toMatchObject({
      success: true,
      tenantId: 'demo-tenant',
      servicesCount: 25,
      kbCount: 36,
      knowledgeBaseReset: false,
    });
  });

  it('only replaces KB when resetKnowledgeBase is explicitly true', async () => {
    const prisma = createPrismaMock();
    applyIndustrySeedToTenantMock.mockResolvedValue({
      servicesCount: 3,
      kbCount: 6,
      displayName: 'Beauty Demo',
    });
    const service = new DemoService(prisma as never);

    const result = await service.resetDemo('beauty', undefined, {
      resetKnowledgeBase: true,
    });

    expect(applyIndustrySeedToTenantMock).toHaveBeenCalledWith(
      prisma,
      'demo-tenant',
      'beauty',
    );
    expect(result).toMatchObject({
      knowledgeBaseReset: true,
      servicesCount: 3,
      kbCount: 6,
    });
  });

  it('clears a demo conversation without resetting KB', async () => {
    const prisma = createPrismaMock();
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      tenantId: 'demo-tenant',
    });
    prisma.$transaction.mockResolvedValue(undefined);
    prisma.knowledgeDocument.count
      .mockResolvedValueOnce(25)
      .mockResolvedValueOnce(36);
    const service = new DemoService(prisma as never);

    await service.resetDemo('beauty', 'conv-1');

    expect(prisma.$transaction).toHaveBeenCalledWith([
      prisma.message.deleteMany({ where: { conversationId: 'conv-1' } }),
      prisma.aiRun.deleteMany({ where: { conversationId: 'conv-1' } }),
    ]);
    expect(updateBookingDraftMock).toHaveBeenCalledWith('conv-1', null, false);
    expect(applyIndustrySeedToTenantMock).not.toHaveBeenCalled();
  });

  it('rejects unknown industries', async () => {
    const service = new DemoService(createPrismaMock() as never);

    await expect(service.resetDemo('unknown')).rejects.toBeInstanceOf(BadRequestException);
  });
});
