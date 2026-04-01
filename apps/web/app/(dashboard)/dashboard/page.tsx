'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-client';

interface DashboardStats {
  conversations: { total: number; today: number };
  contacts: { total: number; today: number };
  bookings: { pending: number; today: number };
  knowledgeDocs: number;
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    api.get<DashboardStats>('/dashboard/stats').then(setStats).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">主控台</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="對話"
          value={stats ? String(stats.conversations.total) : '—'}
          description={stats ? `今日 +${stats.conversations.today}` : '載入中'}
        />
        <StatCard
          title="聯絡人"
          value={stats ? String(stats.contacts.total) : '—'}
          description={stats ? `今日 +${stats.contacts.today}` : '載入中'}
        />
        <StatCard
          title="待確認預約"
          value={stats ? String(stats.bookings.pending) : '—'}
          description={stats ? `今日 ${stats.bookings.today} 筆` : '載入中'}
        />
        <StatCard
          title="知識文檔"
          value={stats ? String(stats.knowledgeDocs) : '—'}
          description="AI 參考資料"
        />
      </div>

      <div className="mt-8 rounded-xl border border-[var(--border)] p-6">
        <h2 className="mb-4 text-lg font-semibold">快速開始</h2>
        <div className="space-y-3 text-sm text-[var(--muted-foreground)]">
          <p>1. 前往「知識庫」新增你的產品/服務資訊</p>
          <p>2. 透過 API 發送測試訊息（POST /api/chat/message）</p>
          <p>3. 在「對話」頁面查看 AI 回覆</p>
          <p>4. 在「預約」頁面查看自動建立的預約</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <p className="text-sm text-[var(--muted-foreground)]">{title}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{description}</p>
    </div>
  );
}
