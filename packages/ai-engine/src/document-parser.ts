/**
 * Document Parser
 *
 * Parses uploaded files (PDF, DOCX, TXT, MD) into plain text.
 */

import mammoth from 'mammoth';

export interface ParseResult {
  success: boolean;
  content: string;
  error?: string;
  metadata?: {
    pageCount?: number;
    wordCount: number;
    charCount: number;
  };
}

/**
 * Parse a file buffer into plain text based on MIME type
 */
export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<ParseResult> {
  try {
    let content: string;
    let metadata: ParseResult['metadata'] = {
      wordCount: 0,
      charCount: 0,
    };

    switch (mimeType) {
      case 'application/pdf':
        content = await parsePdf(buffer, metadata);
        break;

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        content = await parseDocx(buffer);
        break;

      case 'text/plain':
      case 'text/markdown':
        content = buffer.toString('utf-8');
        break;

      default:
        // Try to detect by extension
        const ext = filename.toLowerCase().split('.').pop();
        if (ext === 'pdf') {
          content = await parsePdf(buffer, metadata);
        } else if (ext === 'docx') {
          content = await parseDocx(buffer);
        } else if (ext === 'txt' || ext === 'md') {
          content = buffer.toString('utf-8');
        } else {
          return {
            success: false,
            content: '',
            error: `Unsupported file type: ${mimeType} (${filename})`,
          };
        }
    }

    // Calculate word count
    metadata = metadata || { wordCount: 0, charCount: 0 };
    metadata.wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
    metadata.charCount = content.length;

    return {
      success: true,
      content: content.trim(),
      metadata,
    };
  } catch (error) {
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : 'Unknown parsing error',
    };
  }
}

/**
 * Parse PDF file using dynamic import
 */
async function parsePdf(buffer: Buffer, metadata?: { pageCount?: number }): Promise<string> {
  // Dynamic import for ESM module
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);

  if (metadata && data.numpages) {
    metadata.pageCount = data.numpages;
  }

  return data.text;
}

/**
 * Parse DOCX file
 */
async function parseDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Detect file type from filename
 */
export function detectMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();

  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    txt: 'text/plain',
    md: 'text/markdown',
  };

  return mimeTypes[ext || ''] || 'application/octet-stream';
}

/**
 * Extract title from filename (without extension)
 */
export function extractTitle(filename: string): string {
  // Remove extension
  const baseName = filename.replace(/\.[^/.]+$/, '');

  // Replace underscores and hyphens with spaces
  return baseName.replace(/[_-]/g, ' ').trim();
}