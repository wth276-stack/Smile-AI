'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';

interface Message {
  id: string;
  sender: 'CUSTOMER' | 'AI' | 'HUMAN';
  content: string;
  createdAt: string;
}

interface ConversationSignals {
  conversationStage?: string;
  customerEmotion?: string;
  customerResistance?: string;
  customerReadiness?: number;
  customerTrust?: number;
  customerStyle?: string;
  strategy?: string;
  conversationMode?: string;
}

interface ConversationDetail {
  id: string;
  channel: string;
  status: string;
  createdAt: string;
  contact: { id: string; name: string | null; phone: string | null; email: string | null };
  messages: Message[];
  signals?: ConversationSignals;
}

export default function ConversationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api
      .get<ConversationDetail>(`/conversations/${id}`)
      .then(setConv)
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <div>
        <Link href="/dashboard/conversations" className="text-sm text-blue-600 hover:underline">
          ← 返回對話列表
        </Link>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
      </div>
    );
  }

  if (!conv) {
    return (
      <div>
        <Link href="/dashboard/conversations" className="text-sm text-blue-600 hover:underline">
          ← 返回對話列表
        </Link>
        <p className="mt-4 text-[var(--muted-foreground)]">載入中...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-8rem)]">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <Link href="/dashboard/conversations" className="text-sm text-blue-600 hover:underline">
              ← 返回對話列表
            </Link>
            <h1 className="mt-2 text-xl font-bold">
              {conv.contact.name || conv.contact.phone || '未知客戶'}
            </h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {conv.channel} · {conv.status} · {conv.messages.length} 則訊息
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto rounded-xl border border-[var(--border)] p-4 space-y-3">
          {conv.messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === 'CUSTOMER' ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                  msg.sender === 'CUSTOMER'
                    ? 'bg-[var(--muted)] text-[var(--foreground)]'
                    : msg.sender === 'AI'
                      ? 'bg-blue-600 text-white'
                      : 'bg-green-600 text-white'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                <p
                  className={`mt-1 text-xs ${
                    msg.sender === 'CUSTOMER' ? 'text-[var(--muted-foreground)]' : 'opacity-70'
                  }`}
                >
                  {senderLabel(msg.sender)} · {formatTime(msg.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Signals panel */}
      {conv.signals && (
        <div className="w-full lg:w-72 shrink-0 rounded-xl border border-[var(--border)] p-4 overflow-y-auto">
          <h2 className="text-sm font-semibold mb-3 text-[var(--muted-foreground)]">客戶狀態</h2>
          <SignalsPanel signals={conv.signals} />
        </div>
      )}
    </div>
  );
}

function senderLabel(sender: string) {
  const labels: Record<string, string> = { CUSTOMER: '客戶', AI: 'AI', HUMAN: '真人' };
  return labels[sender] || sender;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit' });
}

function SignalsPanel({ signals }: { signals: ConversationSignals }) {
  const emotionEmoji: Record<string, string> = {
    happy: '😊',
    calm: '😌',
    neutral: '😐',
    confused: '😕',
    frustrated: '😤',
    angry: '😠',
    anxious: '😰',
  };

  const stageLabels: Record<string, string> = {
    greeting: '問候',
    discover: '探索',
    clarify: '釐清',
    answer: '回答',
    recommend: '推薦',
    objection: '異議',
    price_discuss: '價格討論',
    negotiate: '協商',
    booking_init: '預約開始',
    booking_slots: '收集資料',
    confirm: '確認',
    post_booking: '預約完成',
    complaint: '投訴',
    repair: '修復',
    escalation: '轉交',
    follow_up: '跟進',
    upsell: '加購',
    close: '結束',
    unknown: '未知',
  };

  const strategyLabels: Record<string, string> = {
    discover_need: '探索需求',
    answer_question: '回答問題',
    handle_objection: '處理異議',
    collect_slots: '收集資料',
    confirm_booking: '確認預約',
    escalate: '轉交',
    close_deal: '成交',
    nurture: '培養',
    repair_relationship: '修復關係',
  };

  const resistanceLabels: Record<string, string> = {
    none: '無',
    price: '價格',
    timing: '時間',
    trust: '信任',
    need: '需求不明確',
    competition: '競爭',
  };

  const styleLabels: Record<string, string> = {
    supportive: '支持型',
    analytical: '分析型',
    direct: '直接型',
    exploratory: '探索型',
  };

  const modeLabels: Record<string, string> = {
    GREETING: '問候',
    INQUIRY: '查詢',
    BOOKING_DRAFT: '預約中',
    CONFIRMATION_PENDING: '待確認',
    POST_BOOKING: '已預約',
    HANDOFF: '轉交',
  };

  return (
    <div className="space-y-4">
      {/* Stage */}
      {signals.conversationStage && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted-foreground)]">階段</span>
          <span className="text-sm font-medium">{stageLabels[signals.conversationStage] || signals.conversationStage}</span>
        </div>
      )}

      {/* Mode */}
      {signals.conversationMode && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted-foreground)]">模式</span>
          <span className="text-sm font-medium">{modeLabels[signals.conversationMode] || signals.conversationMode}</span>
        </div>
      )}

      {/* Strategy */}
      {signals.strategy && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted-foreground)]">策略</span>
          <span className="text-sm font-medium">{strategyLabels[signals.strategy] || signals.strategy}</span>
        </div>
      )}

      <hr className="border-[var(--border)]" />

      {/* Emotion */}
      {signals.customerEmotion && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted-foreground)]">情緒</span>
          <span className="text-sm">
            {emotionEmoji[signals.customerEmotion] || ''} {signals.customerEmotion}
          </span>
        </div>
      )}

      {/* Trust */}
      {signals.customerTrust !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--muted-foreground)]">信任度</span>
            <span className="text-sm">{signals.customerTrust}/5</span>
          </div>
          <div className="h-1.5 bg-[var(--muted)] rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full"
              style={{ width: `${(signals.customerTrust / 5) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Readiness */}
      {signals.customerReadiness !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--muted-foreground)]">購買準備度</span>
            <span className="text-sm">{signals.customerReadiness}/5</span>
          </div>
          <div className="h-1.5 bg-[var(--muted)] rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full"
              style={{ width: `${(signals.customerReadiness / 5) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Resistance */}
      {signals.customerResistance && signals.customerResistance !== 'none' && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted-foreground)]">阻力</span>
          <span className="text-sm">{resistanceLabels[signals.customerResistance] || signals.customerResistance}</span>
        </div>
      )}

      {/* Style */}
      {signals.customerStyle && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted-foreground)]">溝通風格</span>
          <span className="text-sm">{styleLabels[signals.customerStyle] || signals.customerStyle}</span>
        </div>
      )}
    </div>
  );
}
