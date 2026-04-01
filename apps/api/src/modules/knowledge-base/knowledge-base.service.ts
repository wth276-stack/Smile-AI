import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseDocument, extractTitle } from '@ats/ai-engine';

@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.knowledgeDocument.findMany({
      where: { tenantId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(tenantId: string, data: {
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
  }) {
    return this.prisma.knowledgeDocument.create({
      data: {
        ...data,
        tenantId,
        docType: data.docType || 'GENERAL',
      },
    });
  }

  async update(tenantId: string, id: string, data: {
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
  }) {
    return this.prisma.knowledgeDocument.update({
      where: { id },
      data,
    });
  }

  async softDelete(tenantId: string, id: string) {
    await this.prisma.knowledgeDocument.findFirstOrThrow({ where: { id, tenantId } });
    return this.prisma.knowledgeDocument.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async search(tenantId: string, query: string): Promise<any[]> {
    const keywords = this.extractKeywords(query);

    if (keywords.length === 0) {
      return this.prisma.knowledgeDocument.findMany({
        where: { tenantId, isActive: true },
        take: 5,
      });
    }

    const conditions = keywords.flatMap((kw) => [
      { title: { contains: kw, mode: 'insensitive' as const } },
      { content: { contains: kw, mode: 'insensitive' as const } },
    ]);

    return this.prisma.knowledgeDocument.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: conditions,
      },
      take: 5,
    });
  }

  private extractKeywords(message: string): string[] {
    const enStopWords = new Set([
      'i', 'a', 'an', 'the', 'to', 'is', 'am', 'are', 'was', 'be',
      'want', 'do', 'can', 'please', 'would', 'like', 'need',
      'hi', 'hello', 'hey', 'what', 'how', 'about', 'some', 'any',
      'it', 'my', 'me', 'you', 'your', 'we', 'they', 'this', 'that',
    ]);

    const zhStopPattern = /^(我|你|的|了|是|在|有|和|就|不|也|都|要|會|可以|可|這|那|到|說|想|想要|嗎|呢|吧|啊|喔|哦|嘛|啦|請問|請|幫|幫我|我想|我要|買|想買)$/;

    const keywords: string[] = [];

    const englishWords = message.match(/[a-zA-Z]{2,}/g) || [];
    for (const w of englishWords) {
      if (!enStopWords.has(w.toLowerCase())) {
        keywords.push(w);
      }
    }

    const chineseChars = message.replace(/[^\u4e00-\u9fff]/g, '');
    const stripped = chineseChars.replace(/[我你的了是在有和就不也都要會可以可這那到說想買請問請幫嗎呢吧啊喔哦嘛啦]/g, '');

    if (stripped.length >= 2) {
      keywords.push(stripped);
      for (let i = 0; i < stripped.length - 1; i++) {
        keywords.push(stripped.substring(i, i + 2));
      }
    } else if (chineseChars.length >= 2) {
      for (let i = 0; i < chineseChars.length - 1; i++) {
        const bigram = chineseChars.substring(i, i + 2);
        if (!zhStopPattern.test(bigram)) {
          keywords.push(bigram);
        }
      }
    }

    return [...new Set(keywords)];
  }

  /**
   * Upload a file and parse it into a Knowledge Document
   * P0-2A: Raw content storage only (no field extraction yet)
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
    // Parse the document
    const result = await parseDocument(file.buffer, file.mimetype, file.originalname);

    if (!result.success) {
      throw new BadRequestException(result.error || 'Failed to parse document');
    }

    // Extract title from filename
    const title = extractTitle(file.originalname);

    // Create KB document with raw content
    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        tenantId,
        title,
        content: result.content,
        docType: 'GENERAL', // Will be changed to SERVICE later in P0-2B
        isActive: true,
      },
    });

    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      docType: doc.docType,
      wordCount: result.metadata?.wordCount || 0,
      charCount: result.metadata?.charCount || 0,
    };
  }
}
