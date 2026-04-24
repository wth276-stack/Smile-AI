'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { X } from 'lucide-react';

const NAV_ITEMS = [
  { label: '主控台', href: '/dashboard', icon: '📊' },
  { label: '對話', href: '/dashboard/conversations', icon: '💬' },
  { label: '聯絡人', href: '/dashboard/contacts', icon: '👥' },
  { label: '預約', href: '/dashboard/bookings', icon: '📅' },
  { label: '知識庫', href: '/dashboard/knowledge-base', icon: '📚' },
  { label: '設定', href: '/dashboard/settings', icon: '⚙️' },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, logout } = useAuthStore();
  const pathname = usePathname();

  return (
    <>
      {/* Backdrop - mobile only */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-[var(--sidebar-width)] flex-col border-r border-[var(--border)] bg-[var(--background)] transition-transform duration-200 md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between border-b border-[var(--border)] px-4">
          <span className="text-lg font-bold">AI Top Sales</span>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] md:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[var(--muted)] ${
                  isActive
                    ? 'bg-[var(--muted)] font-medium text-[var(--foreground)]'
                    : 'text-[var(--foreground)]'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="border-t border-[var(--border)] p-3">
          <div className="flex items-center justify-between">
            <div className="truncate text-sm">
              <p className="font-medium">{user?.name}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{user?.email}</p>
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
    </>
  );
}