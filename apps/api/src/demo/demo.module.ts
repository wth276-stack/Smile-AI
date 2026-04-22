import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoTenantBootstrapService } from './demo-tenant-bootstrap.service';

@Module({
  controllers: [DemoController],
  providers: [DemoService, DemoTenantBootstrapService],
})
export class DemoModule {}
