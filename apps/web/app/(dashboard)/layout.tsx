'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-client';
import { Sidebar } from './_components/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, isLoading, fetchMe } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 md:ml-[var(--sidebar-width)]">
        {/* Mobile top bar */}
        <div className="flex h-14 items-center border-b border-[var(--border)] px-4 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        {/* Desktop spacer */}
        <div className="hidden h-14 md:block" />
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}