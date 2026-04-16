import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { DemoService } from './demo.service';
import { ResetDemoDto } from './dto/reset-demo.dto';
import { getAllIndustryIds } from './industry-seeds';

@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get('industries')
  industries() {
    return getAllIndustryIds();
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset(@Body() dto: ResetDemoDto) {
    return this.demo.resetDemo(dto.industryId, dto.conversationId);
  }
}
