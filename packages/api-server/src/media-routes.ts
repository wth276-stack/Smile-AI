import { Router } from 'express';
import multer from 'multer';
import { processIncomingMedia, type MediaInput } from './media-processor';
import { getMediaById } from '../../database/src/media-helpers';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const TENANT_ID = process.env.TENANT_ID || 'demo-tenant';

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const mediaType = getMediaTypeFromMime(req.file.mimetype);
    const conversationHistory =
      typeof req.body.conversationHistory === 'string' ? req.body.conversationHistory : '';

    const result = await processIncomingMedia({
      tenantId: TENANT_ID,
      channel: 'webchat',
      mediaType,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
      buffer: req.file.buffer,
      conversationHistory,
    });

    res.json({
      mediaId: result.mediaId,
      reply: result.aiReply,
      analysis: result.analysis,
    });
  } catch (err: unknown) {
    console.error('[media] Upload failed:', err);
    const message = err instanceof Error ? err.message : 'Upload failed';
    res.status(500).json({ error: message });
  }
});

router.post('/process-whatsapp', async (req, res) => {
  try {
    const { mediaUrl, mediaType, mimeType, messageId, conversationHistory } = req.body ?? {};

    if (!mediaUrl || !mediaType || !mimeType) {
      res.status(400).json({ error: 'mediaUrl, mediaType, mimeType are required' });
      return;
    }

    const normalizedType = parseBodyMediaType(mediaType);
    if (!normalizedType) {
      res.status(400).json({ error: 'mediaType must be image, video, audio, or document' });
      return;
    }

    const result = await processIncomingMedia({
      tenantId: TENANT_ID,
      channel: 'whatsapp',
      mediaType: normalizedType,
      mimeType,
      messageId,
      url: mediaUrl,
      authToken: process.env.WHATSAPP_ACCESS_TOKEN,
      conversationHistory:
        typeof conversationHistory === 'string' ? conversationHistory : undefined,
    });

    res.json({
      mediaId: result.mediaId,
      reply: result.aiReply,
      analysis: result.analysis,
    });
  } catch (err: unknown) {
    console.error('[media] WhatsApp process failed:', err);
    const message = err instanceof Error ? err.message : 'Processing failed';
    res.status(500).json({ error: message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const media = await getMediaById(req.params.id);
    if (!media) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }
    res.json(media);
  } catch (err: unknown) {
    console.error('[media] Get failed:', err);
    const message = err instanceof Error ? err.message : 'Failed to get media';
    res.status(500).json({ error: message });
  }
});

function getMediaTypeFromMime(mimeType: string): MediaInput['mediaType'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

function parseBodyMediaType(value: unknown): MediaInput['mediaType'] | null {
  if (value !== 'image' && value !== 'video' && value !== 'audio' && value !== 'document') {
    return null;
  }
  return value;
}

export default router;
