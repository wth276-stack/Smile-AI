'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-client';

const NAV_ITEMS = [
  { label: '主控台', href: '/dashboard', icon: '📊' },
  { label: '對話', href: '/dashboard/conversations', icon: '💬' },
  { label: '聯絡人', href: '/dashboard/contacts', icon: '👥' },
  { label: '預約', href: '/dashboard/bookings', icon: '📅' },
  { label: '知識庫', href: '/dashboard/knowledge-base', icon: '📚' },
  { label: '設定', href: '/dashboard/settings', icon: '⚙️' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isLoading, fetchMe, logout } = useAuthStore();

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    if (!isLoading && !user && !api.getToken()) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-[var(--muted-foreground)]">載入中...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 flex h-screen w-[var(--sidebar-width)] flex-col border-r border-[var(--border)] bg-[var(--background)]">
        <div className="flex h-14 items-center border-b border-[var(--border)] px-4">
          <span className="text-lg font-bold">AI Top Sales</span>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] p-3">
          <div className="flex items-center justify-between">
            <div className="truncate text-sm">
              <p className="font-medium">{user.name}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{user.email}</p>
            </div>
            <button
              onClick={logout}
              className="rounded-lg px-2 py-1 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
            >
              登出
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-[var(--sidebar-width)] flex-1">
        <div className="h-14 border-b border-[var(--border)]" />
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
