import 'dotenv/config';
import path from 'path';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { runAiEngineV2 } from '../../ai-engine/src/v2/engine';
import { submitV2Booking, getBookingsForPhone, modifyBooking, cancelBooking } from '../../database/src/v2-helpers';
import { getKnowledgeChunksFromDB } from '../../database/src/service-helpers';
import {
  findOrCreateWebchatConversation,
  loadConversationHistory,
  saveMessages,
  getBookingDraft,
  updateBookingDraft,
  resetConversation,
  closeConversation,
} from '../../database/src/conversation-helpers';
import { adminRouter } from './admin-routes';
import mediaRoutes from './media-routes';
console.log('[api-server] adminRouter loaded:', typeof adminRouter);
import type { AiEngineInput, KnowledgeChunk, BookingDraft } from '../../ai-engine/src/types';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Knowledge base ──

const MAX_MESSAGES = 20;
const TENANT_ID = 'demo-tenant';

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use('/api/chat', chatLimiter);
app.use('/admin', adminLimiter);

// ── Routes ──

app.use('/admin', adminRouter);
app.use('/api/media', mediaRoutes);
console.log('[api-server] admin routes mounted');

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/chat/reset/:sessionId', async (req, res) => {
  const sid = req.params.sessionId;
  try {
    const conversation = await findOrCreateWebchatConversation(sid, TENANT_ID);
    await resetConversation(conversation.id);
    res.json({ status: 'cleared', sessionId: sid });
  } catch (err) {
    console.error('[api-server] Reset error:', err);
    res.status(500).json({ error: 'Failed to reset conversation' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body ?? {};

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const sid = sessionId ?? 'anonymous';

  try {
    const conversation = await findOrCreateWebchatConversation(sid, TENANT_ID);
    const convId = conversation.id;

    const bookingDraft = (await getBookingDraft(convId)) as BookingDraft | null;
    // Look up existing bookings if we have a phone number
    const draftPhone = bookingDraft?.phone ?? null;
    const existingBookings = draftPhone
      ? await getBookingsForPhone(draftPhone, TENANT_ID)
      : [];

    const history = await loadConversationHistory(convId, MAX_MESSAGES);
    const engineMessages = history.map((m) => ({
      sender: (m.role === 'user' ? 'CUSTOMER' : 'AI') as 'CUSTOMER' | 'AI',
      content: m.content,
      createdAt: new Date().toISOString(),
    }));

    const knowledgeChunks = await getKnowledgeChunksFromDB(TENANT_ID);

    const input: AiEngineInput = {
      tenant: { id: TENANT_ID, plan: 'pro', settings: {} },
      contact: { id: conversation.contactId, tags: [] },
      conversation: { id: convId, channel: 'WEBCHAT' as any, messageCount: history.length + 1 },
      messages: engineMessages,
      currentMessage: message,
      knowledge: knowledgeChunks,
      bookingDraft: bookingDraft ?? undefined,
      existingBookings,
    };

    const result = await runAiEngineV2(input);

    const rawLlmJson = (result as any)._rawLlmJson;
    const aiReplyText = result.replyText;

    try {
      await saveMessages(convId, message, aiReplyText, rawLlmJson);
    } catch (err) {
      console.error('[api-server] Failed to save messages:', err);
    }

    if (result.signals.bookingDraft) {
      try {
        await updateBookingDraft(convId, result.signals.bookingDraft as unknown as Record<string, unknown>);
      } catch (err) {
        console.error('[api-server] Failed to update booking draft:', err);
      }
    }

    if ((result as any)._v2Action === 'SUBMIT_BOOKING' && result.signals.bookingDraft) {
      const slots = result.signals.bookingDraft;
      try {
        const booking = await submitV2Booking(slots, TENANT_ID);
        console.log('[api] Booking saved:', booking.id);
        await closeConversation(convId);
      } catch (err) {
        console.error('[api] Failed to save booking to DB:', err);
      }
    }

    if ((result as any)._v2Action === 'MODIFY_BOOKING' && result.signals.bookingDraft) {
      const draft = result.signals.bookingDraft;
      if (draft.bookingId) {
        try {
          const updated = await modifyBooking(draft.bookingId, TENANT_ID, {
            date: draft.date ?? undefined,
            time: draft.time ?? undefined,
          });
          console.log('[api] Booking modified:', updated.id, updated.startTime);
        } catch (err) {
          console.error('[api] Failed to modify booking:', err);
        }
      }
    }

    if ((result as any)._v2Action === 'CANCEL_BOOKING' && result.signals.bookingDraft) {
      const draft = result.signals.bookingDraft;
      if (draft.bookingId) {
        try {
          const cancelled = await cancelBooking(draft.bookingId, TENANT_ID);
          console.log('[api] Booking cancelled:', cancelled.id);
        } catch (err) {
          console.error('[api] Failed to cancel booking:', err);
        }
      }
    }

    res.json(result);
  } catch (err) {
    console.error('[api-server] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/test', (_req, res) => {
  res.json({ ok: true });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api-server] Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[api-server] Unhandled rejection:', reason);
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`[api-server] Listening on http://localhost:${port}`);
});
