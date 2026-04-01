import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@UseGuards(JwtAuthGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('current')
  getCurrent(@TenantId() tenantId: string) {
    return this.tenants.findById(tenantId);
  }

  @Patch('settings')
  updateSettings(
    @TenantId() tenantId: string,
    @Body() body: { settings: Record<string, unknown> },
  ) {
    return this.tenants.updateSettings(tenantId, body.settings);
  }
}
