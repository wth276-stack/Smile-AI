'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';

interface Conversation {
  id: string;
  channel: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  contact: { id: string; name: string | null; phone: string | null };
  lastMessage: { content: string; sender: string; createdAt: string } | null;
  messageCount: number;
}

interface ConversationsResponse {
  items: Conversation[];
  total: number;
}

export default function ConversationsPage() {
  const [data, setData] = useState<ConversationsResponse | null>(null);
  const [error, setError] = useState('');

  const fetchData = useCallback(() => {
    api
      .get<ConversationsResponse>('/conversations')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">對話</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">對話</h1>
        <p className="text-[var(--muted-foreground)]">載入中...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">對話</h1>
        <button
          onClick={fetchData}
          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
        >
          刷新
        </button>
      </div>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] p-8 text-center text-[var(--muted-foreground)]">
          <p>尚無對話</p>
          <p className="mt-2 text-sm">透過 chat API 發送訊息後，對話會自動出現</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((conv) => (
            <Link
              key={conv.id}
              href={`/dashboard/conversations/${conv.id}`}
              className="block rounded-xl border border-[var(--border)] p-4 transition-colors hover:bg-[var(--muted)]"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {conv.contact.name || conv.contact.phone || '未知客戶'}
                    </span>
                    <ChannelBadge channel={conv.channel} />
                    <StatusDot status={conv.status} />
                  </div>
                  {conv.lastMessage && (
                    <p className="mt-1 truncate text-sm text-[var(--muted-foreground)]">
                      {conv.lastMessage.sender === 'AI' ? 'AI: ' : ''}
                      {conv.lastMessage.content}
                    </p>
                  )}
                </div>
                <div className="ml-4 text-right text-xs text-[var(--muted-foreground)] shrink-0">
                  <p>{formatRelativeTime(conv.updatedAt)}</p>
                  <p className="mt-1">{conv.messageCount} 則訊息</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--muted-foreground)]">共 {data.total} 個對話</p>
    </div>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const labels: Record<string, string> = { WEBCHAT: '網頁', WHATSAPP: 'WhatsApp', INSTAGRAM: 'IG', FACEBOOK: 'FB' };
  return (
    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
      {labels[channel] || channel}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'OPEN' ? 'bg-green-500' : 'bg-gray-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function formatRelativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}
