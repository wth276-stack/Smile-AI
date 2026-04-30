import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { DemoService } from './demo.service';
import { ResetDemoDto } from './dto/reset-demo.dto';
import { RebindWhatsappDemoDto } from './dto/rebind-whatsapp-demo.dto';
import { getAllIndustryIds, getDemoTenantIdForIndustryId } from '@ats/database';
import { DemoAdminTokenGuard } from './demo-admin.guard';

@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get('industries')
  industries() {
    return getAllIndustryIds().map((r) => ({
      id: r.id,
      displayName: r.displayName,
      tenantId: getDemoTenantIdForIndustryId(r.id) ?? null,
    }));
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DemoAdminTokenGuard)
  reset(@Body() dto: ResetDemoDto) {
    return this.demo.resetDemo(dto.industryId, dto.conversationId, {
      resetKnowledgeBase: dto.resetKnowledgeBase === true,
    });
  }

  /**
   * Rebinds the test WhatsApp ChannelConfig to the tenant for the selected industry
   * (one number → switchable demo, until you add one number per tenant in production).
   */
  @Post('rebind-whatsapp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DemoAdminTokenGuard)
  rebindWhatsapp(@Body() dto: RebindWhatsappDemoDto) {
    return this.demo.rebindWhatsAppToIndustry(dto.industryId, dto.channelConfigId);
  }
}
