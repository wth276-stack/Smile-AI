import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseDocument, extractTitle } from '@ats/ai-engine';
import { parseImportContent, type ParsedKbItem, type ImportMode } from '@ats/ai-engine';

export interface ImportPreview {
  mode: ImportMode;
  items: Array<{
    title: string;
    docType: string;
    category?: string;
    aliases: string[];
    effect?: string;
    suitable?: string;
    unsuitable?: string;
    precaution?: string;
    duration?: string;
    price?: string;
    discountPrice?: string;
    steps: string[];
    faqItems: Array<{ question: string; answer: string }>;
    content: string;
    preview: string; // First 200 chars for preview
  }>;
  wordCount: number;
  charCount: number;
}

export interface ImportConfirm {
  itemIds: string[]; // IDs of created KB documents
}

@Injectable()
export class KbImportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parse uploaded file and return preview
   */
  async previewImport(
    tenantId: string,
    file: Express.Multer.File,
  ): Promise<ImportPreview> {
    // Parse document to text
    const parseResult = await parseDocument(file.buffer, file.mimetype, file.originalname);

    if (!parseResult.success) {
      throw new BadRequestException(parseResult.error || 'Failed to parse document');
    }

    const content = parseResult.content;

    // Parse content into KB items
    const result = parseImportContent(content, file.originalname);

    // Build preview items
    const previewItems = result.items.map((item) => ({
      title: item.title,
      docType: item.docType,
      category: item.category,
      aliases: item.aliases,
      effect: item.effect,
      suitable: item.suitable,
      unsuitable: item.unsuitable,
      precaution: item.precaution,
      duration: item.duration,
      price: item.price,
      discountPrice: item.discountPrice,
      steps: item.steps,
      faqItems: item.faqItems,
      content: item.content,
      preview: this.buildPreview(item),
    }));

    return {
      mode: result.mode,
      items: previewItems,
      wordCount: parseResult.metadata?.wordCount || 0,
      charCount: parseResult.metadata?.charCount || 0,
    };
  }

  /**
   * Confirm import - save items to database
   */
  async confirmImport(
    tenantId: string,
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
      isActive?: boolean;
    }>,
  ): Promise<{ ids: string[]; count: number }> {
    const createdIds: string[] = [];

    for (const item of items) {
      const doc = await this.prisma.knowledgeDocument.create({
        data: {
          tenantId,
          title: item.title,
          docType: item.docType as any,
          category: item.category,
          aliases: item.aliases || [],
          effect: item.effect,
          suitable: item.suitable,
          unsuitable: item.unsuitable,
          precaution: item.precaution,
          duration: item.duration,
          price: item.price,
          discountPrice: item.discountPrice,
          steps: item.steps || [],
          faqItems: item.faqItems || [],
          content: item.content || '',
          isActive: item.isActive !== false,
        },
      });
      createdIds.push(doc.id);
    }

    return {
      ids: createdIds,
      count: createdIds.length,
    };
  }

  /**
   * Build preview text for an item
   */
  private buildPreview(item: ParsedKbItem): string {
    const parts: string[] = [];

    if (item.effect) {
      parts.push(`功效: ${item.effect.substring(0, 50)}...`);
    }
    if (item.price) {
      parts.push(`價錢: ${item.price}`);
    }
    if (item.discountPrice) {
      parts.push(`優惠: ${item.discountPrice}`);
    }
    if (item.content) {
      parts.push(item.content.substring(0, 100) + '...');
    }

    return parts.join(' | ').substring(0, 200);
  }

  /**
   * Legacy: Upload and parse as single raw document (P0-2A)
   * Will be replaced by previewImport + confirmImport
   */
  async uploadAndParse(
    tenantId: string,
    file: Express.Multer.File,
  ): Promise<{
    id: string;
    title: string;
    content: string;
    docType: string;
    wordCount: number;
    charCount: number;
  }> {
    // Parse document
    const parseResult = await parseDocument(file.buffer, file.mimetype, file.originalname);

    if (!parseResult.success) {
      throw new BadRequestException(parseResult.error || 'Failed to parse document');
    }

    // Extract title from filename (with proper encoding handling)
    const title = this.sanitizeTitle(file.originalname);

    // Create KB document with raw content
    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        tenantId,
        title,
        content: parseResult.content,
        docType: 'GENERAL', // Will be changed in P0-2B preview
        isActive: true,
      },
    });

    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      docType: doc.docType,
      wordCount: parseResult.metadata?.wordCount || 0,
      charCount: parseResult.metadata?.charCount || 0,
    };
  }

  /**
   * Sanitize title from filename
   */
  private sanitizeTitle(filename: string): string {
    // Remove extension
    let title = filename.replace(/\.[^/.]+$/, '');

    // Replace underscores and hyphens with spaces
    title = title.replace(/[_-]/g, ' ');

    // Handle URL encoding if present
    try {
      title = decodeURIComponent(title);
    } catch {
      // If decoding fails, keep original
    }

    // Trim and limit length
    title = title.trim().substring(0, 200);

    return title || 'Untitled';
  }
}