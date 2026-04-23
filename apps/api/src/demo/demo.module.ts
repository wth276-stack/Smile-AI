import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoTenantBootstrapService } from './demo-tenant-bootstrap.service';
import { DemoAdminTokenGuard } from './demo-admin.guard';

@Module({
  controllers: [DemoController],
  providers: [DemoService, DemoTenantBootstrapService, DemoAdminTokenGuard],
})
export class DemoModule {}
