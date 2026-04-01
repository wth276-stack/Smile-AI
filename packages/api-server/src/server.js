// api-server/src/server.js
import express from 'express';
import cors from 'cors';
import { getSession, updateSlots, getMessages, addMessage } from './session.js';
import { buildSystemPrompt } from '../../ai-engine/src/prompt.js';
import { callLLM } from '../../ai-engine/src/engine.js';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }

    // 1. Get or create session (from SQLite now)
    const session = getSession(sessionId);

    // 2. Save user message to DB
    addMessage(sessionId, 'user', message);

    // 3. Build system prompt with current booking state
    const systemPrompt = buildSystemPrompt(session.slots);

    // 4. Load full message history from DB
    const history = getMessages(sessionId);
    const llmMessages = [
      { role: 'system', content: systemPrompt },
      ...history,
    ];

    // 5. Call LLM
    const rawResponse = await callLLM(llmMessages);

    // 6. Parse response
    let parsed;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      console.error('Failed to parse LLM response:', rawResponse);
      return res.status(500).json({ error: 'AI response was not valid JSON' });
    }

    // 7. Save assistant message to DB (store the full JSON so history is complete)
    addMessage(sessionId, 'assistant', rawResponse);

    // 8. Update slots if there are new ones
    let allSlots = session.slots;
    if (parsed.newSlots && Object.keys(parsed.newSlots).length > 0) {
      allSlots = updateSlots(sessionId, parsed.newSlots);
    }

    // 9. Return response
    res.json({
      reply: parsed.reply,
      action: parsed.action,
      intent: parsed.intent,
      slots: allSlots,
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});