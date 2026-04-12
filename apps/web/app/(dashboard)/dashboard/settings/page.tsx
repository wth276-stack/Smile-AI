'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';

type TenantResponse = {
  id: string;
  name: string;
  plan: string;
  settings: Record<string, unknown>;
};

/** Sentinel: user must fill custom business type string. */
const BUSINESS_TYPE_OTHER = '__custom__';

const BUSINESS_TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: '美容中心 Beauty salon', value: 'beauty and wellness salon' },
  { label: '醫療診所 Medical clinic', value: 'medical clinic' },
  { label: '牙科診所 Dental clinic', value: 'dental clinic' },
  { label: '健身 Gym / fitness', value: 'gym' },
  { label: '餐廳 Restaurant / cafe', value: 'restaurant' },
  { label: '髮型屋 Hair salon', value: 'hair salon' },
  { label: '其他 Other（自填）', value: BUSINESS_TYPE_OTHER },
];

const LANGUAGE_OPTIONS: { label: string; value: string }[] = [
  { label: '粵語為主', value: '粵語為主，可切換英文' },
  { label: '國語為主', value: '國語為主，可切換英文' },
  { label: 'English', value: 'English preferred' },
  { label: '粵語 + English', value: '粵語 + English' },
];

function placeholderForBusinessType(businessType: string): string {
  if (businessType === BUSINESS_TYPE_OTHER) {
    return '例如：符合品牌語調、專業且易明';
  }
  const t = businessType.toLowerCase();
  if (t.includes('beauty') || t.includes('hair')) {
    return '例如：親切、專業、不硬銷；以療程效果與皮膚需求為中心';
  }
  if (t.includes('medical') || t.includes('dental') || t.includes('clinic')) {
    return '例如：專業、清晰、不作診斷；協助預約與一般資訊';
  }
  if (t.includes('gym') || t.includes('fitness')) {
    return '例如：鼓勵式、注意安全；協助了解課程與試堂';
  }
  if (t.includes('restaurant') || t.includes('cafe')) {
    return '例如：熱情、簡潔；協助訂位與菜式過敏資訊';
  }
  return '例如：符合品牌語調、專業且易明';
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState(BUSINESS_TYPE_OPTIONS[0].value);
  /** When dropdown is「其他」, persisted value for settings.businessType */
  const [businessTypeCustom, setBusinessTypeCustom] = useState('');
  const [assistantRole, setAssistantRole] = useState('');
  const [language, setLanguage] = useState(LANGUAGE_OPTIONS[0].value);

  const assistantPlaceholder = useMemo(
    () =>
      placeholderForBusinessType(
        businessType === BUSINESS_TYPE_OTHER
          ? businessTypeCustom.trim() || 'business'
          : businessType,
      ),
    [businessType, businessTypeCustom],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tenant = await api.get<TenantResponse>('/tenants/current');
      const s = tenant.settings ?? {};
      const bn =
        typeof s.businessName === 'string' && s.businessName
          ? s.businessName
          : tenant.name || '';
      const bt =
        typeof s.businessType === 'string' && s.businessType
          ? s.businessType
          : BUSINESS_TYPE_OPTIONS[0].value;
      const ar = typeof s.assistantRole === 'string' ? s.assistantRole : '';
      const lang =
        typeof s.language === 'string' && s.language
          ? s.language
          : LANGUAGE_OPTIONS[0].value;

      setBusinessName(bn);
      const known = BUSINESS_TYPE_OPTIONS.some((o) => o.value === bt);
      if (known) {
        setBusinessType(bt);
        setBusinessTypeCustom('');
      } else {
        setBusinessType(BUSINESS_TYPE_OTHER);
        setBusinessTypeCustom(bt);
      }
      setAssistantRole(ar);
      const langMatch = LANGUAGE_OPTIONS.find((o) => o.value === lang);
      setLanguage(langMatch ? langMatch.value : lang);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '無法載入設定');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const tenant = await api.get<TenantResponse>('/tenants/current');
      const prev = tenant.settings ?? {};
      const resolvedBusinessType =
        businessType === BUSINESS_TYPE_OTHER
          ? businessTypeCustom.trim() || 'business'
          : businessType;
      const settings: Record<string, unknown> = {
        ...prev,
        businessName: businessName.trim() || tenant.name,
        businessType: resolvedBusinessType,
        assistantRole: assistantRole.trim(),
        language,
      };
      await api.patch<TenantResponse>('/tenants/settings', { settings });
      setSavedAt(new Date().toLocaleString('zh-HK'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">設定</h1>
        <p className="text-sm text-[var(--muted-foreground)]">載入中…</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">設定</h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      <section className="max-w-xl rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">AI 與公司資料</h2>
        <p className="mb-6 text-sm text-[var(--muted-foreground)]">
          這些資料會寫入租戶 settings，供 AI（V2）建立角色與語氣。後端 PATCH 會整份取代{' '}
          <code className="rounded bg-[var(--muted)] px-1">settings</code>
          ，所以此頁會先讀取現有 settings，再與表單合併成<strong>完整 object</strong> 一次送出，避免誤刪其他 key。
        </p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Business Name（公司／店名）</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="美容療程示範店"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Business Type（行業）</label>
            <select
              value={businessType}
              onChange={(e) => {
                setBusinessType(e.target.value);
                if (e.target.value !== BUSINESS_TYPE_OTHER) setBusinessTypeCustom('');
              }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              {BUSINESS_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {businessType === BUSINESS_TYPE_OTHER && (
              <div className="mt-2">
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                  自訂行業描述（會寫入 settings.businessType）
                </label>
                <input
                  type="text"
                  value={businessTypeCustom}
                  onChange={(e) => setBusinessTypeCustom(e.target.value)}
                  placeholder="例如：寵物美容、法律諮詢、裝修工程"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Assistant Role / Personality（AI 語氣與角色）
            </label>
            <textarea
              value={assistantRole}
              onChange={(e) => setAssistantRole(e.target.value)}
              rows={4}
              placeholder={assistantPlaceholder}
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Language（語言偏好）</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.label} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm font-medium text-[var(--background)] disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
          {savedAt && (
            <span className="text-sm text-[var(--muted-foreground)]">已於 {savedAt} 儲存</span>
          )}
        </div>
      </section>
    </div>
  );
}
