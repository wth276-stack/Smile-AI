import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, pagination: PaginationDto) {
    const { page = 1, pageSize = 20, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.contact.findMany({
        where: { tenantId },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
      }),
      this.prisma.contact.count({ where: { tenantId } }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findById(tenantId: string, id: string) {
    return this.prisma.contact.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        conversations: { orderBy: { updatedAt: 'desc' }, take: 5 },
        orders: { orderBy: { createdAt: 'desc' }, take: 5 },
        bookings: { orderBy: { startTime: 'desc' }, take: 5 },
      },
    });
  }

  async create(tenantId: string, data: { name?: string; phone?: string; email?: string; tags?: string[] }) {
    return this.prisma.contact.create({ data: { ...data, tenantId } });
  }

  async update(tenantId: string, id: string, data: { name?: string; phone?: string; email?: string; tags?: string[]; notes?: string }) {
    await this.prisma.contact.findFirstOrThrow({ where: { id, tenantId } });
    return this.prisma.contact.update({
      where: { id },
      data,
    });
  }

  async resolveOrCreate(tenantId: string, externalContactId: string, name?: string) {
    const existing = await this.prisma.contact.findFirst({
      where: {
        tenantId,
        externalIds: { path: ['webchat'], equals: externalContactId },
      },
    });

    if (existing) {
      if (name && !existing.name) {
        return this.prisma.contact.update({
          where: { id: existing.id },
          data: { name },
        });
      }
      return existing;
    }

    return this.prisma.contact.create({
      data: {
        tenantId,
        name: name || null,
        externalIds: { webchat: externalContactId },
      },
    });
  }
}
