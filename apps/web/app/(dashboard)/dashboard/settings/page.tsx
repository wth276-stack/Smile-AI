'use client';

export default function SettingsPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">設定</h1>
      <div className="space-y-4">
        <section className="rounded-xl border border-[var(--border)] p-6">
          <h2 className="mb-2 text-lg font-semibold">公司資料</h2>
          <p className="text-sm text-[var(--muted-foreground)]">管理你的公司名稱和基本設定</p>
        </section>
        <section className="rounded-xl border border-[var(--border)] p-6">
          <h2 className="mb-2 text-lg font-semibold">渠道整合</h2>
          <p className="text-sm text-[var(--muted-foreground)]">連接 WhatsApp、Instagram、Facebook 等渠道</p>
        </section>
        <section className="rounded-xl border border-[var(--border)] p-6">
          <h2 className="mb-2 text-lg font-semibold">AI 設定</h2>
          <p className="text-sm text-[var(--muted-foreground)]">配置 AI 回覆風格和行為規則</p>
        </section>
      </div>
    </div>
  );
}
