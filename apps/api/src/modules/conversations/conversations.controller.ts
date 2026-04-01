import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() pagination: PaginationDto) {
    return this.conversations.findAll(tenantId, pagination);
  }

  @Get(':id')
  async findById(@TenantId() tenantId: string, @Param('id') id: string) {
    const [conversation, signals] = await Promise.all([
      this.conversations.findByIdWithMessages(tenantId, id),
      this.conversations.getLatestSignals(id),
    ]);
    return { ...conversation, signals };
  }
}
