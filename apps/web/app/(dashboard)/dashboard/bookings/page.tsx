'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Booking {
  id: string;
  status: string;
  serviceName: string;
  startTime: string;
  endTime: string | null;
  notes: string | null;
  createdAt: string;
  contact: { id: string; name: string | null; phone: string | null };
}

interface BookingsResponse {
  items: Booking[];
  total: number;
}

export default function BookingsPage() {
  const [data, setData] = useState<BookingsResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<BookingsResponse>('/bookings')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">預約</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">預約</h1>
        <p className="text-[var(--muted-foreground)]">載入中...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">預約</h1>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] p-8 text-center text-[var(--muted-foreground)]">
          <p>尚無預約記錄</p>
          <p className="mt-2 text-sm">客戶透過 AI 對話預約後會自動出現</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">客戶</th>
                <th className="px-4 py-3 font-medium">服務</th>
                <th className="px-4 py-3 font-medium">時間</th>
                <th className="px-4 py-3 font-medium">狀態</th>
                <th className="px-4 py-3 font-medium">建立日期</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((b) => (
                <tr key={b.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3">{b.contact.name || b.contact.phone || '未知'}</td>
                  <td className="px-4 py-3">{b.serviceName}</td>
                  <td className="px-4 py-3">{formatDateTime(b.startTime)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {formatDateTime(b.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--muted-foreground)]">
        共 {data.total} 筆預約
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    CONFIRMED: 'bg-blue-100 text-blue-800',
    COMPLETED: 'bg-green-100 text-green-800',
    NO_SHOW: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-gray-100 text-gray-600',
  };

  const labels: Record<string, string> = {
    PENDING: '待確認',
    CONFIRMED: '已確認',
    COMPLETED: '已完成',
    NO_SHOW: '未出席',
    CANCELLED: '已取消',
  };

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] || 'bg-gray-100'}`}>
      {labels[status] || status}
    </span>
  );
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('zh-HK', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
