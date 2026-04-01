import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import { computeBookingIdempotencyKey } from './booking-idempotency.util';

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, pagination: PaginationDto) {
    const { page = 1, pageSize = 20, sortBy = 'startTime', sortOrder = 'asc' } = pagination;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.booking.findMany({
        where: { tenantId },
        include: { contact: { select: { id: true, name: true, phone: true } } },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: pageSize,
      }),
      this.prisma.booking.count({ where: { tenantId } }),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findById(tenantId: string, id: string) {
    return this.prisma.booking.findFirstOrThrow({
      where: { id, tenantId },
      include: { contact: true },
    });
  }

  async create(tenantId: string, contactId: string, data: {
    serviceName: string;
    startTime: Date;
    endTime?: Date;
    notes?: string;
  }) {
    return this.prisma.booking.create({
      data: { tenantId, contactId, ...data },
    });
  }

  /**
   * AI CREATE_BOOKING path: deterministic idempotency key + unique index prevents duplicate rows on retries.
   * Returns existing row when key already exists (race-safe via P2002 fallback).
   */
  async upsertFromAiSideEffect(
    tenantId: string,
    contactId: string,
    data: { serviceName: string; startTime: Date; endTime?: Date; notes?: string },
  ): Promise<{ booking: { id: string }; created: boolean }> {
    const startMs = data.startTime.getTime();
    const key = computeBookingIdempotencyKey(tenantId, contactId, data.serviceName, startMs);

    const existing = await this.prisma.booking.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      return { booking: existing, created: false };
    }

    try {
      const booking = await this.prisma.booking.create({
        data: {
          tenantId,
          contactId,
          serviceName: data.serviceName.trim(),
          startTime: data.startTime,
          endTime: data.endTime,
          notes: data.notes,
          idempotencyKey: key,
        },
      });
      return { booking, created: true };
    } catch (e: unknown) {
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: string }).code) : '';
      if (code === 'P2002') {
        const again = await this.prisma.booking.findUnique({ where: { idempotencyKey: key } });
        if (again) return { booking: again, created: false };
      }
      throw e;
    }
  }

  async update(tenantId: string, id: string, data: {
    status?: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
    startTime?: Date;
    endTime?: Date;
    notes?: string;
  }) {
    return this.prisma.booking.update({
      where: { id },
      data,
    });
  }
}
