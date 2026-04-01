import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './client';

const MEDIA_DIR = path.resolve(process.cwd(), 'uploads', 'media');

function ensureMediaDir() {
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
  }
}

export async function saveMediaFromBuffer(
  buffer: Buffer,
  options: {
    tenantId: string;
    channel: string;
    mediaType: string;
    mimeType: string;
    messageId?: string;
    fileName?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ id: string; localPath: string }> {
  ensureMediaDir();

  const ext = mimeToExt(options.mimeType);
  const hash = crypto.randomBytes(8).toString('hex');
  const filename = `${Date.now()}-${hash}${ext}`;
  const localPath = path.join(MEDIA_DIR, filename);

  fs.writeFileSync(localPath, buffer);

  const record = await prisma.mediaMessage.create({
    data: {
      tenantId: options.tenantId,
      channel: options.channel,
      mediaType: options.mediaType,
      mimeType: options.mimeType,
      messageId: options.messageId ?? null,
      fileName: options.fileName ?? filename,
      fileSize: buffer.length,
      localPath,
      metadata: (options.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  return { id: record.id, localPath };
}

export async function saveMediaFromUrl(
  url: string,
  options: {
    tenantId: string;
    channel: string;
    mediaType: string;
    mimeType: string;
    messageId?: string;
    fileName?: string;
    authToken?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ id: string; localPath: string; buffer: Buffer }> {
  ensureMediaDir();

  const headers: Record<string, string> = {};
  if (options.authToken) {
    headers.Authorization = `Bearer ${options.authToken}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const ext = mimeToExt(options.mimeType);
  const hash = crypto.randomBytes(8).toString('hex');
  const filename = `${Date.now()}-${hash}${ext}`;
  const localPath = path.join(MEDIA_DIR, filename);

  fs.writeFileSync(localPath, buffer);

  const record = await prisma.mediaMessage.create({
    data: {
      tenantId: options.tenantId,
      channel: options.channel,
      mediaType: options.mediaType,
      mimeType: options.mimeType,
      originalUrl: url,
      messageId: options.messageId ?? null,
      fileName: options.fileName ?? filename,
      fileSize: buffer.length,
      localPath,
      metadata: (options.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  return { id: record.id, localPath, buffer };
}

export async function updateMediaAnalysis(mediaId: string, analysis: string) {
  return prisma.mediaMessage.update({
    where: { id: mediaId },
    data: { aiAnalysis: analysis },
  });
}

export async function getMediaById(mediaId: string) {
  return prisma.mediaMessage.findUnique({ where: { id: mediaId } });
}

export async function getMediaByMessageId(messageId: string) {
  return prisma.mediaMessage.findMany({
    where: { messageId },
    orderBy: { createdAt: 'asc' },
  });
}

export function readMediaFile(localPath: string): Buffer | null {
  if (!fs.existsSync(localPath)) return null;
  return fs.readFileSync(localPath);
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'application/pdf': '.pdf',
  };
  return map[mimeType] || '.bin';
}
