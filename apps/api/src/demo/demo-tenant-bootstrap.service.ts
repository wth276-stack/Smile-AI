import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ensureDemoTenantStructuredSlotSettings,
  ensureDemoIndustryTenantsStructuredSlotSettings,
} from '@ats/database';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Self-heal: production demo-tenant rows created before structured businessHours existed
 * never get settings from prisma seed; patch at startup (idempotent).
 * Logs via ensureDemoTenantStructuredSlotSettings: [SlotGate] tenant=demo-tenant ...
 */
@Injectable()
export class DemoTenantBootstrapService implements OnModuleInit {
  private readonly log = new Logger(DemoTenantBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await ensureDemoTenantStructuredSlotSettings(this.prisma);
    } catch (e) {
      this.log.warn(`ensureDemoTenantStructuredSlotSettings failed (non-fatal): ${String(e)}`);
    }
    try {
      await ensureDemoIndustryTenantsStructuredSlotSettings(this.prisma);
    } catch (e) {
      this.log.warn(`ensureDemoIndustryTenantsStructuredSlotSettings failed (non-fatal): ${String(e)}`);
    }
  }
}
