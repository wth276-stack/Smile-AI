import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KbImportService } from './kb-import.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId } from '../../common/decorators/tenant-id.decorator';

@UseGuards(JwtAuthGuard)
@Controller('knowledge-base')
export class KnowledgeBaseController {
  constructor(
    private readonly kb: KnowledgeBaseService,
    private readonly importService: KbImportService,
  ) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.kb.findAll(tenantId);
  }

  @Get('search')
  search(@TenantId() tenantId: string, @Query('q') q: string) {
    return this.kb.search(tenantId, q);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() body: {
      title: string;
      content: string;
      category?: string;
      tags?: string[];
      aliases?: string[];
      docType?: 'SERVICE' | 'FAQ' | 'GENERAL';
      effect?: string;
      suitable?: string;
      unsuitable?: string;
      precaution?: string;
      duration?: string;
      price?: string;
      discountPrice?: string;
      steps?: string[];
      faqItems?: Array<{ question: string; answer: string }>;
    },
  ) {
    return this.kb.create(tenantId, body);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: {
      title?: string;
      content?: string;
      category?: string;
      tags?: string[];
      aliases?: string[];
      isActive?: boolean;
      docType?: 'SERVICE' | 'FAQ' | 'GENERAL';
      effect?: string;
      suitable?: string;
      unsuitable?: string;
      precaution?: string;
      duration?: string;
      price?: string;
      discountPrice?: string;
      steps?: string[];
      faqItems?: Array<{ question: string; answer: string }>;
    },
  ) {
    return this.kb.update(tenantId, id, body);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.kb.softDelete(tenantId, id);
  }

  /**
   * P0-2B: Upload and preview import
   * Returns parsed items for user to review before confirming
   */
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file'))
  async previewImport(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
    ];

    const ext = file.originalname.toLowerCase().split('.').pop();
    const allowedExtensions = ['pdf', 'docx', 'txt', 'md'];

    if (!allowedTypes.includes(file.mimetype) && !allowedExtensions.includes(ext || '')) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: PDF, DOCX, TXT, MD`,
      );
    }

    return this.importService.previewImport(tenantId, file);
  }

  /**
   * P0-2B: Confirm import after preview
   * User can edit items before confirming
   */
  @Post('import/confirm')
  async confirmImport(
    @TenantId() tenantId: string,
    @Body() body: {
      items: Array<{
        title: string;
        docType: string;
        category?: string;
        aliases?: string[];
        effect?: string;
        suitable?: string;
        unsuitable?: string;
        precaution?: string;
        duration?: string;
        price?: string;
        discountPrice?: string;
        steps?: string[];
        faqItems?: Array<{ question: string; answer: string }>;
        content?: string;
      }>;
    },
  ) {
    if (!body.items || body.items.length === 0) {
      throw new BadRequestException('No items provided');
    }

    return this.importService.confirmImport(tenantId, body.items);
  }

  /**
   * P0-2A: Legacy upload (single raw document)
   * @deprecated Use import/preview + import/confirm instead
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @TenantId() tenantId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
    ];

    const ext = file.originalname.toLowerCase().split('.').pop();
    const allowedExtensions = ['pdf', 'docx', 'txt', 'md'];

    if (!allowedTypes.includes(file.mimetype) && !allowedExtensions.includes(ext || '')) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: PDF, DOCX, TXT, MD`,
      );
    }

    return this.importService.uploadAndParse(tenantId, file);
  }
}
