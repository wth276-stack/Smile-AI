'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const TENANT_SLUG = 'demo-tenant';

interface IndustryConfig {
  icon: string;
  label: string;
  welcome: string;
  quickActions: { label: string; message: string }[];
}

const INDUSTRY_CONFIG: Record<string, IndustryConfig> = {
  beauty: {
    icon: '💆',
    label: '美容',
    welcome: '你好！我係星悅美容中心嘅 AI 助手，隨時為你服務 💆',
    quickActions: [
      { label: '問價錢', message: '想問下你哋啲療程幾錢？' },
      { label: '試預約', message: '我想預約' },
      { label: '改期 / 取消', message: '我想改期' },
      { label: '問療程功效', message: '想了解下你哋啲療程有咩功效？' },
    ],
  },
  cleaning: {
    icon: '🧹',
    label: '清潔',
    welcome: '你好！我係亮晶晶清潔服務嘅 AI 助手，隨時為你服務 🧹',
    quickActions: [
      { label: '問價錢', message: '想問下清潔服務幾錢？' },
      { label: '試預約', message: '我想預約清潔服務' },
      { label: '改期 / 取消', message: '我想改期' },
      { label: '服務範圍', message: '你哋服務範圍包括邊區？' },
    ],
  },
  renovation: {
    icon: '🔨',
    label: '裝修',
    welcome: '你好！我係匠心裝修工程嘅 AI 助手，隨時為你服務 🔨',
    quickActions: [
      { label: '問價錢', message: '想問下裝修大概幾錢？' },
      { label: '免費度尺', message: '我想安排免費度尺' },
      { label: '工程保養', message: '你哋工程有咩保養？' },
      { label: '付款方式', message: '付款方式係點樣？' },
    ],
  },
  consulting: {
    icon: '💼',
    label: '咨詢',
    welcome: '你好！我係信諾私人咨詢中心嘅 AI 助手，隨時為你服務 💼',
    quickActions: [
      { label: '問價錢', message: '想問下咨詢收費？' },
      { label: '試預約', message: '我想預約咨詢' },
      { label: '私隱政策', message: '咨詢內容保密嗎？' },
      { label: '服務種類', message: '你哋有咩咨詢服務？' },
    ],
  },
  fitness: {
    icon: '🧘',
    label: '健身',
    welcome: '你好！我係 ZenFit Studio 嘅 AI 助手，隨時為你服務 🧘',
    quickActions: [
      { label: '問價錢', message: '想問下課堂收費？' },
      { label: '體驗堂', message: '我想試堂' },
      { label: '套票優惠', message: '有冇套票優惠？' },
      { label: '場地設施', message: '你哋有咩設施？' },
    ],
  },
};

const TAB_ORDER = ['beauty', 'cleaning', 'renovation', 'consulting', 'fitness'] as const;

export default function HeroChatMultiIndustry() {
  const [currentIndustry, setCurrentIndustry] = useState<string>('beauty');
  const [industries, setIndustries] = useState<{ id: string; displayName: string }[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/demo/industries`);
        if (res.ok) {
          const data = (await res.json()) as { id: string; displayName: string }[];
          if (!cancelled) setIndustries(data);
        }
      } catch (err) {
        console.error('Load industries error:', err);
      }

      try {
        await fetch(`${API_BASE}/api/demo/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ industryId: 'beauty' }),
        });
      } catch (err) {
        console.error('Initial reset error:', err);
      }

      if (!cancelled) {
        setMessages([{ role: 'assistant', content: INDUSTRY_CONFIG.beauty.welcome }]);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
      setInputValue('');
      setIsLoading(true);

      const body: { tenantSlug: string; message: string; conversationId?: string } = {
        tenantSlug: TENANT_SLUG,
        message: trimmed,
      };

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        if (conversationId?.trim()) {
          body.conversationId = conversationId.trim();
        }

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

        const data = (await res.json()) as {
          reply?: string;
          message?: string;
          response?: string;
          conversationId?: string;
        };

        const nextId = data.conversationId?.trim();
        if (nextId) {
          setConversationId(nextId);
        }

        const aiReply =
          (typeof data.reply === 'string' && data.reply) ||
          (typeof data.message === 'string' && data.message) ||
          (typeof data.response === 'string' && data.response) ||
          '';

        setMessages((prev) => [...prev, { role: 'assistant', content: aiReply }]);
      } catch (err) {
        console.error('Send message error:', err);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '抱歉，系統暫時出現問題，請稍後再試。',
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, conversationId],
  );

  const switchIndustry = async (industryId: string) => {
    if (industryId === currentIndustry || isSwitching) return;

    setIsSwitching(true);

    try {
      await fetch(`${API_BASE}/api/demo/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          industryId,
          conversationId: conversationId || undefined,
        }),
      });

      setConversationId(null);
      setMessages([]);
      setCurrentIndustry(industryId);
      setInputValue('');

      const welcome =
        INDUSTRY_CONFIG[industryId]?.welcome || '你好！有咩可以幫到你？';
      setMessages([{ role: 'assistant', content: welcome }]);
    } catch (err) {
      console.error('Switch industry error:', err);
    } finally {
      setIsSwitching(false);
    }
  };

  const currentConfig = INDUSTRY_CONFIG[currentIndustry];
  const currentDisplayName =
    industries.find((i) => i.id === currentIndustry)?.displayName ||
    currentConfig?.label ||
    '';

  const showQuickActions =
    messages.length <= 1 ||
    messages[messages.length - 1]?.role === 'assistant';

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(inputValue);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
      <div
        className="w-full max-w-[480px] flex flex-col bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden relative h-[85vh] md:h-[70vh] max-h-[900px]"
      >
        {isSwitching && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm">
            <div className="h-10 w-10 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="mt-3 text-sm text-gray-700 dark:text-gray-200">切換行業中...</p>
          </div>
        )}

        <div className="shrink-0 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          <div className="flex min-w-0 gap-1 px-2 py-2">
            {TAB_ORDER.map((id) => {
              const cfg = INDUSTRY_CONFIG[id];
              const active = currentIndustry === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={isSwitching}
                  onClick={() => void switchIndustry(id)}
                  className={`shrink-0 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-b-2 border-blue-600'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/80'
                  } disabled:opacity-50`}
                >
                  {cfg.icon} {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/80">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>
              {currentConfig?.icon}
            </span>
            <div>
              <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {currentDisplayName}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">AI 銷售助手 Demo</p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
          {messages.map((msg, i) => (
            <div
              key={`${i}-${msg.role}-${msg.content.slice(0, 12)}`}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-md border border-gray-200/80 dark:border-gray-600'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm">
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
                  <span>AI 正在輸入…</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {showQuickActions && currentConfig && !isLoading && (
          <div className="shrink-0 px-3 pb-2 overflow-x-auto">
            <div className="flex gap-2 min-w-0 pb-1">
              {currentConfig.quickActions.map((qa) => (
                <button
                  key={qa.label}
                  type="button"
                  disabled={isSwitching || isLoading}
                  onClick={() => void sendMessage(qa.message)}
                  className="shrink-0 rounded-full border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
          <div className="flex gap-2">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="輸入訊息..."
              disabled={isLoading || isSwitching}
              rows={1}
              className="flex-1 min-h-[44px] max-h-28 resize-none rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              aria-label="訊息輸入"
            />
            <button
              type="button"
              disabled={!inputValue.trim() || isLoading || isSwitching}
              onClick={() => void sendMessage(inputValue)}
              className="shrink-0 min-h-[44px] px-4 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              發送
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
