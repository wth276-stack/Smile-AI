'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

interface Message {
  id: string;
  sender: 'CUSTOMER' | 'AI';
  content: string;
  time: string;
}

function conversationStorageKey(tenantSlug: string) {
  return `chat_${tenantSlug}_conversationId`;
}

export default function PublicChatPage() {
  const params = useParams();
  const tenantSlug = typeof params?.tenantSlug === 'string' ? params.tenantSlug : '';

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tenantSlug || typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(conversationStorageKey(tenantSlug));
      if (stored?.trim()) setConversationId(stored.trim());
    } catch {
      /* ignore */
    }
  }, [tenantSlug]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const sendMessage = useCallback(async () => {
    if (!tenantSlug || !input.trim() || loading) return;

    const text = input.trim();
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      sender: 'CUSTOMER',
      content: text,
      time: new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const body: { tenantSlug: string; message: string; conversationId?: string } = {
      tenantSlug,
      message: text,
    };
    if (conversationId) body.conversationId = conversationId;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

        console.log('API_BASE =', API_BASE);
        const res = await fetch(`${API_BASE}/api/chat/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg =
          typeof errData === 'object' && errData && 'message' in errData
            ? String((errData as { message?: unknown }).message)
            : `HTTP ${res.status}`;
        throw new Error(msg || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { reply: string; conversationId: string };
      const nextId = data.conversationId?.trim();
      if (nextId) {
        setConversationId(nextId);
        try {
          localStorage.setItem(conversationStorageKey(tenantSlug), nextId);
        } catch {
          /* ignore */
        }
      }

      const aiMessage: Message = {
        id: `msg-${Date.now()}-ai`,
        sender: 'AI',
        content: data.reply,
        time: new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('請求逾時，請稍後再試。');
      } else if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('無法連接到伺服器，請稍後再試。');
      } else {
        setError(err instanceof Error ? err.message : '發送失敗');
      }
      console.error('Public chat error:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, input, loading, conversationId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  if (!tenantSlug) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gray-50 text-gray-600 text-sm p-4">
        無效的連結
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] h-[100dvh] bg-gray-50 flex flex-col overflow-hidden">
      <header className="shrink-0 bg-white border-b px-4 py-3 shadow-sm pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="max-w-lg mx-auto">
          <h1 className="text-base font-semibold text-gray-900">線上諮詢</h1>
          <p className="text-xs text-gray-500">我哋會盡快回覆你</p>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="max-w-lg mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <div className="inline-block bg-blue-50 rounded-2xl px-5 py-4 mb-3 text-left">
                <p className="text-blue-900 font-medium text-sm">你好！歡迎聯絡我哋</p>
                <p className="text-blue-800/90 text-sm mt-1">
                  有咩關於療程、價錢或預約想問，都可以直接打字。
                </p>
              </div>
              <p className="text-gray-400 text-xs">例如：「HIFU 幾錢？」「想預約」</p>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === 'CUSTOMER' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.sender === 'CUSTOMER'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-white border shadow-sm text-gray-900 rounded-bl-md'
                }`}
              >
                <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                <p
                  className={`text-[11px] mt-1 ${
                    msg.sender === 'CUSTOMER' ? 'text-blue-200' : 'text-gray-400'
                  }`}
                >
                  {msg.sender === 'AI' ? '助理' : '你'} · {msg.time}
                </p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border shadow-sm rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" />
                    <span
                      className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: '120ms' }}
                    />
                    <span
                      className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: '240ms' }}
                    />
                  </span>
                  <span>回覆緊…</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 max-w-full text-center">
                {error}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className="shrink-0 bg-white border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-lg mx-auto flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入訊息…"
            className="flex-1 border rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] max-h-32"
            rows={1}
            disabled={loading}
            aria-label="訊息輸入"
          />
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={!input.trim() || loading}
            className="shrink-0 bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            發送
          </button>
        </div>
      </footer>
    </div>
  );
}
