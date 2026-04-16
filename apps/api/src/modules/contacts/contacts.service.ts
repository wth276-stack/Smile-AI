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

  /**
   * After CREATE_BOOKING: merge draft name/phone onto contact without failing on
   * @@unique([tenantId, phone]) when another contact already owns that phone.
   */
  async updateFromBookingDraftSafe(
    tenantId: string,
    contactId: string,
    draft: { customerName?: string | null; phone?: string | null },
  ): Promise<void> {
    try {
      const name = draft.customerName?.trim() || undefined;
      const phone = draft.phone?.trim() || undefined;
      if (!name && !phone) return;

      await this.prisma.contact.findFirstOrThrow({ where: { id: contactId, tenantId } });

      if (phone) {
        const existingOther = await this.prisma.contact.findFirst({
          where: {
            tenantId,
            phone,
            NOT: { id: contactId },
          },
        });
        if (existingOther) {
          if (name) {
            await this.prisma.contact.update({
              where: { id: contactId },
              data: { name },
            });
          }
          return;
        }
      }

      const data: { name?: string; phone?: string } = {};
      if (name) data.name = name;
      if (phone) data.phone = phone;
      if (Object.keys(data).length === 0) return;

      await this.prisma.contact.update({
        where: { id: contactId },
        data,
      });
    } catch (err) {
      console.warn(
        '[Contact Update] Non-critical error (booking still saved):',
        err instanceof Error ? err.message : String(err),
      );
    }
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
