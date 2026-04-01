'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  sender: 'CUSTOMER' | 'AI';
  content: string;
  time: string;
  enginePath?: 'thin-core-v1' | 'llm-first' | 'legacy-fallback' | 'legacy';
  fallbackReason?: string;
}

// Demo tenant - 可以改成你嘅實際 tenant ID
const DEFAULT_TENANT_ID = 'demo-tenant';
const DEMO_CONTACT_ID = 'demo-contact';

export default function DemoChatPage() {
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID);
  const [contactId] = useState(DEMO_CONTACT_ID);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      sender: 'CUSTOMER',
      content: input.trim(),
      time: new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const res = await fetch(`${API_BASE}/api/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          channel: 'WEBCHAT',
          externalContactId: contactId,
          contactName: 'Demo User',
          message: userMessage.content,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `HTTP ${res.status}`);
      }

      const data = await res.json();

      const aiMessage: Message = {
        id: `msg-${Date.now()}-ai`,
        sender: 'AI',
        content: data.reply,
        time: new Date().toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' }),
        enginePath: data.enginePath,
        fallbackReason: data.fallbackReason,
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('請求逾時，請確認 API 正在運行（pnpm dev:api）');
      } else if (err instanceof TypeError && err.message.includes('fetch')) {
        setError('無法連接到 API，請確認 API 已啟動（pnpm dev:api）');
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
      }
      console.error('Chat error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b px-4 py-3 shadow-sm">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-lg font-bold text-gray-900">AI Sales Demo</h1>
          <p className="text-xs text-gray-500">美容療程 AI 客服示範</p>
        </div>
      </header>

      {/* Config Bar */}
      <div className="bg-white border-b px-4 py-2">
        <div className="max-w-2xl mx-auto flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-gray-600">Tenant ID:</span>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="border rounded px-2 py-1 text-xs w-40"
              placeholder="輸入 Tenant ID"
            />
          </label>
          <span className="text-gray-400">|</span>
          <span className="text-gray-500 text-xs">Contact: {contactId}</span>
          <a href="/login" className="ml-auto text-blue-500 hover:text-blue-700 text-xs">
            登入 Dashboard →
          </a>
          <button
            onClick={clearChat}
            className="text-red-500 hover:text-red-700 text-xs"
          >
            清除對話
          </button>
        </div>
      </div>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Welcome Message */}
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="inline-block bg-blue-50 rounded-2xl px-6 py-4 mb-4">
                <p className="text-blue-800 font-medium">你好！我係 AI 客服助理</p>
                <p className="text-blue-600 text-sm mt-1">
                  有咩可以幫到你？你可以問我關於療程、價錢、預約等問題。
                </p>
              </div>
              <div className="text-gray-400 text-sm">
                <p>試吓問：</p>
                <ul className="mt-2 space-y-1">
                  <li>「HIFU 幾錢？」</li>
                  <li>「有咩療程推薦？」</li>
                  <li>「點樣預約？」</li>
                </ul>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === 'CUSTOMER' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.sender === 'CUSTOMER'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-white border shadow-sm text-gray-900 rounded-bl-md'
                }`}
              >
                <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                <p
                  className={`text-xs mt-1 ${
                    msg.sender === 'CUSTOMER' ? 'text-blue-200' : 'text-gray-400'
                  }`}
                >
                  {msg.sender === 'AI' ? 'AI' : '你'} · {msg.time}
                </p>
                {msg.sender === 'AI' && msg.enginePath && (
                  <div className="text-[10px] mt-1 text-gray-500">
                    {msg.enginePath === 'thin-core-v1'
                      ? 'THIN-CORE-V1'
                      : msg.enginePath === 'llm-first'
                        ? 'LLM-FIRST'
                        : msg.enginePath === 'legacy-fallback'
                          ? 'FALLBACK'
                          : 'LEGACY'}
                    {msg.fallbackReason ? ` · ${msg.fallbackReason}` : ''}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading Indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border shadow-sm rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                  <span>思考中...</span>
                </div>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="flex justify-center">
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600">
                錯誤：{error}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="bg-white border-t px-4 py-3">
        <div className="max-w-2xl mx-auto flex gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="輸入訊息..."
            className="flex-1 border rounded-xl px-4 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={1}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            發送
          </button>
        </div>
        <p className="text-center text-xs text-gray-400 mt-2">
          按 Enter 發送，Shift+Enter 換行
        </p>
      </footer>
    </div>
  );
}