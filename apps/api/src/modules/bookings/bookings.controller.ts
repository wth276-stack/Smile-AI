import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard)
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() pagination: PaginationDto) {
    return this.bookings.findAll(tenantId, pagination);
  }

  @Get(':id')
  findById(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.bookings.findById(tenantId, id);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() body: { contactId: string; serviceName: string; startTime: string; endTime?: string; notes?: string },
  ) {
    return this.bookings.create(tenantId, body.contactId, {
      serviceName: body.serviceName,
      startTime: new Date(body.startTime),
      endTime: body.endTime ? new Date(body.endTime) : undefined,
      notes: body.notes,
    });
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { status?: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED'; startTime?: string; endTime?: string; notes?: string },
  ) {
    return this.bookings.update(tenantId, id, {
      status: body.status,
      startTime: body.startTime ? new Date(body.startTime) : undefined,
      endTime: body.endTime ? new Date(body.endTime) : undefined,
      notes: body.notes,
    });
  }
}
