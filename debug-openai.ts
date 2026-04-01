// debug-openai.ts
// 用法: npx tsx debug-openai.ts

import OpenAI from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function main() {
  console.log('=== OpenAI API Diagnostic ===\n');

  // 1. Check env
  console.log('[1] OPENAI_API_KEY:', OPENAI_API_KEY ? `${OPENAI_API_KEY.slice(0, 8)}...${OPENAI_API_KEY.slice(-4)} (length: ${OPENAI_API_KEY.length})` : '❌ NOT SET');
  console.log('[1] OPENAI_MODEL:', process.env.OPENAI_MODEL || '(not set, will use gpt-4o-mini)');
  console.log('[1] OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL || '(not set, default)');
  console.log('[1] HTTP_PROXY:', process.env.HTTP_PROXY || process.env.http_proxy || '(not set)');
  console.log('[1] HTTPS_PROXY:', process.env.HTTPS_PROXY || process.env.https_proxy || '(not set)');

  if (!OPENAI_API_KEY) {
    console.error('\n❌ OPENAI_API_KEY is not set. Set it and retry.');
    process.exit(1);
  }

  // 2. DNS + connectivity check
  console.log('\n[2] Testing DNS resolution for api.openai.com...');
  try {
    const dns = await import('dns');
    const { promisify } = await import('util');
    const resolve = promisify(dns.resolve);
    const addresses = await resolve('api.openai.com');
    console.log('[2] ✅ DNS resolved:', addresses);
  } catch (e: any) {
    console.error('[2] ❌ DNS resolution failed:', e.message);
  }

  // 3. Raw fetch test (bypass SDK)
  console.log('\n[3] Testing raw fetch to OpenAI API...');
  const fetchStart = Date.now();
  try {
    const resp = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    const elapsed = Date.now() - fetchStart;
    console.log(`[3] Status: ${resp.status} (${elapsed}ms)`);
    if (resp.status === 200) {
      const data = await resp.json() as any;
      const models = data.data?.slice(0, 5).map((m: any) => m.id);
      console.log('[3] ✅ API reachable. Sample models:', models);
    } else {
      const body = await resp.text();
      console.error('[3] ❌ API returned error:', body.slice(0, 300));
    }
  } catch (e: any) {
    const elapsed = Date.now() - fetchStart;
    console.error(`[3] ❌ Fetch failed after ${elapsed}ms:`, e.message);
  }

  // 4. Minimal SDK call
  console.log('\n[4] Testing minimal OpenAI SDK call (gpt-4o-mini, 50 tokens max)...');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const client = new OpenAI({ timeout: 60000, maxRetries: 0 });

  const sdkStart = Date.now();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Say "hello" in 3 words.' }],
      max_tokens: 50,
    });
    const elapsed = Date.now() - sdkStart;
    console.log(`[4] ✅ Success in ${elapsed}ms`);
    console.log('[4] Model:', response.model);
    console.log('[4] Content:', response.choices[0]?.message?.content);
    console.log('[4] Usage:', JSON.stringify(response.usage));
    console.log('[4] Finish reason:', response.choices[0]?.finish_reason);
  } catch (e: any) {
    const elapsed = Date.now() - sdkStart;
    console.error(`[4] ❌ SDK call failed after ${elapsed}ms`);
    console.error('[4] Error type:', e.constructor.name);
    console.error('[4] Error message:', e.message);
    if (e.status) console.error('[4] HTTP status:', e.status);
    if (e.code) console.error('[4] Error code:', e.code);
  }

  // 5. JSON mode test (same as your engine)
  console.log('\n[5] Testing JSON mode call (simulating your engine)...');
  const jsonStart = Date.now();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Respond in JSON format: {"reply":"your response","status":"ok"}' },
        { role: 'user', content: '你好' },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 200,
      temperature: 0.3,
    });
    const elapsed = Date.now() - jsonStart;
    console.log(`[5] ✅ Success in ${elapsed}ms`);
    console.log('[5] Content:', response.choices[0]?.message?.content);
    console.log('[5] Finish reason:', response.choices[0]?.finish_reason);
    console.log('[5] Usage:', JSON.stringify(response.usage));
  } catch (e: any) {
    const elapsed = Date.now() - jsonStart;
    console.error(`[5] ❌ JSON mode call failed after ${elapsed}ms`);
    console.error('[5] Error:', e.message);
  }

  // 6. Large prompt test (simulating your actual payload size)
  console.log('\n[6] Testing with large system prompt (simulating real payload)...');
  const largePrompt = 'You are a WhatsApp sales assistant. ' + 'x'.repeat(2000) +
    '\nRespond in JSON: {"reply":"your response","intent":"GREETING","action":"REPLY","newSlots":{}}';
  const largeStart = Date.now();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: largePrompt },
        { role: 'user', content: '我想預約按摩' },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0.3,
    });
    const elapsed = Date.now() - largeStart;
    console.log(`[6] ✅ Success in ${elapsed}ms`);
    console.log('[6] Content:', response.choices[0]?.message?.content?.slice(0, 200));
    console.log('[6] Finish reason:', response.choices[0]?.finish_reason);
  } catch (e: any) {
    const elapsed = Date.now() - largeStart;
    console.error(`[6] ❌ Large prompt call failed after ${elapsed}ms`);
    console.error('[6] Error:', e.message);
  }

  // 7. Streaming test
  console.log('\n[7] Testing streaming mode...');
  const streamStart = Date.now();
  try {
    const stream = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: '你好' }],
      max_tokens: 100,
      stream: true,
    });
    let fullContent = '';
    let firstChunkMs = 0;
    for await (const chunk of stream) {
      if (!firstChunkMs) firstChunkMs = Date.now() - streamStart;
      const delta = chunk.choices[0]?.delta?.content ?? '';
      fullContent += delta;
    }
    const elapsed = Date.now() - streamStart;
    console.log(`[7] ✅ Streaming success. First chunk: ${firstChunkMs}ms, Total: ${elapsed}ms`);
    console.log('[7] Content:', fullContent);
  } catch (e: any) {
    const elapsed = Date.now() - streamStart;
    console.error(`[7] ❌ Streaming failed after ${elapsed}ms:`, e.message);
  }

  console.log('\n=== Diagnostic Complete ===');
}

main().catch(console.error);