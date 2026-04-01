import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() pagination: PaginationDto) {
    return this.contacts.findAll(tenantId, pagination);
  }

  @Get(':id')
  findById(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.contacts.findById(tenantId, id);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() body: { name?: string; phone?: string; email?: string; tags?: string[] },
  ) {
    return this.contacts.create(tenantId, body);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; phone?: string; email?: string; tags?: string[]; notes?: string },
  ) {
    return this.contacts.update(tenantId, id, body);
  }
}
