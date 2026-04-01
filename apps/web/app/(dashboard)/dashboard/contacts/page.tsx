'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Contact {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface ContactsResponse {
  items: Contact[];
  total: number;
  page: number;
  totalPages: number;
}

export default function ContactsPage() {
  const [data, setData] = useState<ContactsResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<ContactsResponse>('/contacts')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">聯絡人</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">聯絡人</h1>
        <p className="text-[var(--muted-foreground)]">載入中...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">聯絡人</h1>

      {data.items.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] p-8 text-center text-[var(--muted-foreground)]">
          <p>尚無聯絡人</p>
          <p className="mt-2 text-sm">AI 對話自動創建的聯絡人記錄</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-medium">名稱</th>
                <th className="px-4 py-3 font-medium">電話</th>
                <th className="px-4 py-3 font-medium">電郵</th>
                <th className="px-4 py-3 font-medium">標籤</th>
                <th className="px-4 py-3 font-medium">建立日期</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3 font-medium">{c.name || '未命名'}</td>
                  <td className="px-4 py-3">{c.phone || '—'}</td>
                  <td className="px-4 py-3">{c.email || '—'}</td>
                  <td className="px-4 py-3">
                    {c.tags.length > 0
                      ? c.tags.map((t) => (
                          <span key={t} className="mr-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                            {t}
                          </span>
                        ))
                      : <span className="text-[var(--muted-foreground)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">
                    {new Date(c.createdAt).toLocaleDateString('zh-HK')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--muted-foreground)]">共 {data.total} 位聯絡人</p>
    </div>
  );
}
