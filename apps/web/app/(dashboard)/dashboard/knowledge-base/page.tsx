'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api-client';

type DocType = 'SERVICE' | 'FAQ' | 'GENERAL';

interface FaqItem {
  question: string;
  answer: string;
}

interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  aliases: string[];
  docType: DocType;
  effect?: string;
  suitable?: string;
  unsuitable?: string;
  precaution?: string;
  duration?: string;
  price?: string;
  discountPrice?: string;
  steps?: string[];
  faqItems?: FaqItem[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const DOC_TYPE_LABELS: Record<DocType, string> = {
  SERVICE: '服務',
  FAQ: 'FAQ',
  GENERAL: '一般',
};

const SERVICE_FIELDS = ['effect', 'suitable', 'unsuitable', 'precaution', 'duration'] as const;
const FIELD_LABELS: Record<string, string> = {
  effect: '功效',
  suitable: '適合對象',
  unsuitable: '不適合對象',
  precaution: '注意事項',
  duration: '時長',
};

type FormMode = 'closed' | 'create' | 'edit';

interface FormData {
  title: string;
  content: string;
  category: string;
  docType: DocType;
  aliases: string; // comma-separated string for editing
  effect: string;
  suitable: string;
  unsuitable: string;
  precaution: string;
  duration: string;
  price: string;
  discountPrice: string;
  steps: string[];
  faqItems: FaqItem[];
}

const emptyFormData: FormData = {
  title: '',
  content: '',
  category: '',
  docType: 'GENERAL',
  aliases: '',
  effect: '',
  suitable: '',
  unsuitable: '',
  precaution: '',
  duration: '',
  price: '',
  discountPrice: '',
  steps: [],
  faqItems: [],
};

export default function KnowledgeBasePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyFormData);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Preview state for import pipeline
  const [previewItems, setPreviewItems] = useState<FormData[] | null>(null);
  const [previewMode, setPreviewMode] = useState<'idle' | 'previewing' | 'confirming'>('idle');
  const [importFilename, setImportFilename] = useState<string>('');

  const fetchDocs = useCallback(() => {
    setLoading(true);
    api
      .get<KnowledgeDoc[]>('/knowledge-base')
      .then((data) => { setDocs(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const openCreate = () => {
    setFormData(emptyFormData);
    setEditingId(null);
    setFormMode('create');
  };

  const openEdit = (doc: KnowledgeDoc) => {
    setFormData({
      title: doc.title,
      content: doc.content,
      category: doc.category || '',
      docType: doc.docType || 'GENERAL',
      aliases: (doc.aliases || []).join(', '),
      effect: doc.effect || '',
      suitable: doc.suitable || '',
      unsuitable: doc.unsuitable || '',
      precaution: doc.precaution || '',
      duration: doc.duration || '',
      price: doc.price || '',
      discountPrice: doc.discountPrice || '',
      steps: doc.steps || [],
      faqItems: doc.faqItems || [],
    });
    setEditingId(doc.id);
    setFormMode('edit');
  };

  const closeForm = () => {
    setFormMode('closed');
    setEditingId(null);
  };

  // Steps management
  const addStep = () => {
    setFormData((p) => ({ ...p, steps: [...p.steps, ''] }));
  };

  const removeStep = (index: number) => {
    setFormData((p) => ({ ...p, steps: p.steps.filter((_, i) => i !== index) }));
  };

  const updateStep = (index: number, value: string) => {
    setFormData((p) => ({
      ...p,
      steps: p.steps.map((s, i) => (i === index ? value : s)),
    }));
  };

  // FAQ management
  const addFaqItem = () => {
    setFormData((p) => ({
      ...p,
      faqItems: [...p.faqItems, { question: '', answer: '' }],
    }));
  };

  const removeFaqItem = (index: number) => {
    setFormData((p) => ({
      ...p,
      faqItems: p.faqItems.filter((_, i) => i !== index),
    }));
  };

  const updateFaqItem = (index: number, field: 'question' | 'answer', value: string) => {
    setFormData((p) => ({
      ...p,
      faqItems: p.faqItems.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.content.trim()) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: formData.title.trim(),
        content: formData.content.trim(),
        category: formData.category.trim() || undefined,
        docType: formData.docType,
        // Parse aliases from comma-separated string to array
        aliases: formData.aliases
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a.length > 0),
      };

      // Add structured fields for SERVICE type
      if (formData.docType === 'SERVICE') {
        if (formData.effect.trim()) payload.effect = formData.effect.trim();
        if (formData.suitable.trim()) payload.suitable = formData.suitable.trim();
        if (formData.unsuitable.trim()) payload.unsuitable = formData.unsuitable.trim();
        if (formData.precaution.trim()) payload.precaution = formData.precaution.trim();
        if (formData.duration.trim()) payload.duration = formData.duration.trim();
        if (formData.price.trim()) payload.price = formData.price.trim();
        if (formData.discountPrice.trim()) payload.discountPrice = formData.discountPrice.trim();

        // Add steps if any
        const validSteps = formData.steps.filter((s) => s.trim());
        if (validSteps.length > 0) {
          payload.steps = validSteps;
        }
      }

      // Add FAQ items if any
      if (formData.faqItems.length > 0) {
        const validFaqItems = formData.faqItems.filter(
          (item) => item.question.trim() && item.answer.trim()
        );
        if (validFaqItems.length > 0) {
          payload.faqItems = validFaqItems;
        }
      }

      if (formMode === 'edit' && editingId) {
        await api.patch(`/knowledge-base/${editingId}`, payload);
      } else {
        await api.post('/knowledge-base', payload);
      }
      closeForm();
      fetchDocs();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定刪除此知識文檔？')) return;
    try {
      await api.delete(`/knowledge-base/${id}`);
      fetchDocs();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  };

  // File upload handler - P0-2B: Preview/Confirm flow
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'];
    const ext = file.name.toLowerCase().split('.').pop();
    const allowedExt = ['pdf', 'docx', 'txt', 'md'];

    if (!allowedTypes.includes(file.type) && !allowedExt.includes(ext || '')) {
      setUploadError('不支援的檔案類型。支援：PDF, DOCX, TXT, MD');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const formDataObj = new FormData();
      formDataObj.append('file', file);

      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const token = localStorage.getItem('accessToken');

      // Step 1: Call preview endpoint
      const res = await fetch(`${API_BASE}/api/knowledge-base/import/preview`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formDataObj,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || `Preview failed: ${res.status}`);
      }

      const data = await res.json();
      console.log('Preview result:', data);

      // Convert parsed items to FormData for editing
      const parsedItems: FormData[] = data.items.map((item: Partial<KnowledgeDoc>) => ({
        title: item.title || '',
        content: item.content || '',
        category: item.category || '',
        docType: item.docType || 'GENERAL',
        aliases: (item.aliases || []).join(', '),
        effect: item.effect || '',
        suitable: item.suitable || '',
        unsuitable: item.unsuitable || '',
        precaution: item.precaution || '',
        duration: item.duration || '',
        price: item.price || '',
        discountPrice: item.discountPrice || '',
        steps: item.steps || [],
        faqItems: item.faqItems || [],
      }));

      setPreviewItems(parsedItems);
      setImportFilename(file.name);
      setPreviewMode('previewing');
      e.target.value = ''; // Reset file input
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setUploading(false);
    }
  };

  // Confirm import after preview
  const handleConfirmImport = async () => {
    if (!previewItems || previewItems.length === 0) return;

    setPreviewMode('confirming');
    setUploadError(null);

    try {
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const token = localStorage.getItem('accessToken');

      // Convert FormData back to API payload
      const items = previewItems.map((item) => ({
        title: item.title.trim(),
        docType: item.docType,
        category: item.category.trim() || undefined,
        aliases: item.aliases.split(',').map((a) => a.trim()).filter((a) => a),
        effect: item.effect.trim() || undefined,
        suitable: item.suitable.trim() || undefined,
        unsuitable: item.unsuitable.trim() || undefined,
        precaution: item.precaution.trim() || undefined,
        duration: item.duration.trim() || undefined,
        price: item.price.trim() || undefined,
        discountPrice: item.discountPrice.trim() || undefined,
        steps: item.steps.filter((s) => s.trim()),
        faqItems: item.faqItems.filter((f) => f.question.trim() && f.answer.trim()),
        content: item.content.trim(),
      }));

      const res = await fetch(`${API_BASE}/api/knowledge-base/import/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ items }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || `Import failed: ${res.status}`);
      }

      const data = await res.json();
      console.log('Import successful:', data);

      // Reset preview state
      setPreviewItems(null);
      setImportFilename('');
      setPreviewMode('idle');

      // Refresh docs list
      fetchDocs();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Import failed');
      setPreviewMode('previewing');
    }
  };

  // Cancel preview
  const handleCancelPreview = () => {
    setPreviewItems(null);
    setImportFilename('');
    setPreviewMode('idle');
  };

  // Update preview item
  const updatePreviewItem = (index: number, field: keyof FormData, value: string | string[] | FaqItem[]) => {
    setPreviewItems((prev) => {
      if (!prev) return prev;
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold">知識庫</h1>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {error}
          <button onClick={() => { setError(''); fetchDocs(); }} className="ml-4 underline">重試</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">知識庫</h1>
        <div className="flex items-center gap-3">
          {/* File Upload Button (P0-2A) */}
          {formMode === 'closed' && (
            <label className="cursor-pointer rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--muted)]">
              {uploading ? '上傳中...' : '上傳文件'}
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={handleFileUpload}
                disabled={uploading}
                className="hidden"
              />
            </label>
          )}
          {formMode === 'closed' ? (
            <button onClick={openCreate} className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm text-[var(--background)] hover:opacity-90">
              新增文檔
            </button>
          ) : (
            <button onClick={closeForm} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--muted)]">
              取消
            </button>
          )}
        </div>
      </div>

      {/* Upload Error */}
      {uploadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
          {uploadError}
          <button onClick={() => setUploadError(null)} className="ml-2 underline">關閉</button>
        </div>
      )}

      {/* Preview Modal - P0-2B */}
      {previewMode !== 'idle' && previewItems && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-medium text-blue-900">
                匯入預覽 - {importFilename}
              </h3>
              <p className="text-sm text-blue-700">
                已解析 {previewItems.length} 個項目，請檢查後確認匯入
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCancelPreview}
                disabled={previewMode === 'confirming'}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={previewMode === 'confirming'}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {previewMode === 'confirming' ? '匯入中...' : `確認匯入 ${previewItems.length} 項`}
              </button>
            </div>
          </div>

          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            {previewItems.map((item, index) => (
              <div key={index} className="rounded-lg border border-blue-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    value={item.title}
                    onChange={(e) => updatePreviewItem(index, 'title', e.target.value)}
                    className="flex-1 rounded-lg border border-[var(--border)] px-3 py-1 text-sm font-medium"
                    placeholder="標題"
                  />
                  <select
                    value={item.docType}
                    onChange={(e) => updatePreviewItem(index, 'docType', e.target.value as DocType)}
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-sm"
                  >
                    <option value="SERVICE">服務</option>
                    <option value="FAQ">FAQ</option>
                    <option value="GENERAL">一般</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <label className="text-xs text-gray-500">價錢</label>
                    <input
                      type="text"
                      value={item.price}
                      onChange={(e) => updatePreviewItem(index, 'price', e.target.value)}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                      placeholder="HK$..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">優惠價</label>
                    <input
                      type="text"
                      value={item.discountPrice}
                      onChange={(e) => updatePreviewItem(index, 'discountPrice', e.target.value)}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                      placeholder="HK$..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">時長</label>
                    <input
                      type="text"
                      value={item.duration}
                      onChange={(e) => updatePreviewItem(index, 'duration', e.target.value)}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                      placeholder="60-90 分鐘"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">分類</label>
                    <input
                      type="text"
                      value={item.category}
                      onChange={(e) => updatePreviewItem(index, 'category', e.target.value)}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                      placeholder="美容療程"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
                  <div>
                    <label className="text-xs text-gray-500">功效</label>
                    <textarea
                      value={item.effect}
                      onChange={(e) => updatePreviewItem(index, 'effect', e.target.value)}
                      rows={2}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                      placeholder="功效描述"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">適合對象</label>
                    <textarea
                      value={item.suitable}
                      onChange={(e) => updatePreviewItem(index, 'suitable', e.target.value)}
                      rows={2}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                      placeholder="適合對象"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">不適合對象</label>
                    <textarea
                      value={item.suitable}
                      onChange={(e) => updatePreviewItem(index, 'unsuitable', e.target.value)}
                      rows={2}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                      placeholder="不適合對象"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">注意事項</label>
                    <textarea
                      value={item.precaution}
                      onChange={(e) => updatePreviewItem(index, 'precaution', e.target.value)}
                      rows={2}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                      placeholder="注意事項"
                    />
                  </div>
                </div>

                {item.faqItems && item.faqItems.length > 0 && (
                  <div className="mt-3 rounded border border-gray-200 p-2">
                    <p className="text-xs font-medium text-gray-600">常見問題 ({item.faqItems.length})</p>
                    <div className="mt-1 space-y-1">
                      {item.faqItems.slice(0, 3).map((faq, i) => (
                        <p key={i} className="text-xs text-gray-500">
                          Q: {faq.question}
                        </p>
                      ))}
                      {item.faqItems.length > 3 && (
                        <p className="text-xs text-gray-400">... 還有 {item.faqItems.length - 3} 個</p>
                      )}
                    </div>
                  </div>
                )}

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                    查看完整內容
                  </summary>
                  <textarea
                    value={item.content}
                    onChange={(e) => updatePreviewItem(index, 'content', e.target.value)}
                    rows={6}
                    className="mt-2 w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono"
                  />
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {formMode !== 'closed' && (
        <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-[var(--border)] p-4 space-y-3">
          <h3 className="font-medium">{formMode === 'edit' ? '編輯文檔' : '新增文檔'}</h3>

          {/* 文檔類型選擇 */}
          <div>
            <label className="mb-1 block text-sm font-medium">文檔類型</label>
            <select
              value={formData.docType}
              onChange={(e) => setFormData((p) => ({ ...p, docType: e.target.value as DocType }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            >
              <option value="GENERAL">一般 - 品牌故事、公司簡介等</option>
              <option value="FAQ">FAQ - 常見問題（付款、營業時間等）</option>
              <option value="SERVICE">服務 - 美容療程、產品等</option>
            </select>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              選擇「服務」可填寫功效、適合對象、注意事項等結構化欄位
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">標題 *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData((p) => ({ ...p, title: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              placeholder="例如：美白療程"
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">分類</label>
            <input
              type="text"
              value={formData.category}
              onChange={(e) => setFormData((p) => ({ ...p, category: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              placeholder="例如：服務、FAQ、產品"
            />
          </div>

          {/* 別名 - 幫助 AI 匹配 */}
          <div>
            <label className="mb-1 block text-sm font-medium">別名（建議填寫）</label>
            <input
              type="text"
              value={formData.aliases}
              onChange={(e) => setFormData((p) => ({ ...p, aliases: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              placeholder={formData.docType === 'SERVICE' ? '例如：HIFU, 緊緻療程, 超聲波刀' : '例如：付款方式, 如何付款'}
            />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              用逗號分隔多個別名，幫助 AI 識別用戶用不同講法查詢同一項目
            </p>
          </div>

          {/* 服務類型的結構化欄位 */}
          {formData.docType === 'SERVICE' && (
            <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-sm font-medium text-blue-700">服務詳情（強烈建議填寫，AI 會優先使用這些資料回答）</p>

              {/* 價錢 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">價錢</label>
                  <input
                    type="text"
                    value={formData.price}
                    onChange={(e) => setFormData((p) => ({ ...p, price: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                    placeholder="例如：HK$6980 或 6980元"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">優惠價</label>
                  <input
                    type="text"
                    value={formData.discountPrice}
                    onChange={(e) => setFormData((p) => ({ ...p, discountPrice: e.target.value }))}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                    placeholder="例如：HK$4980（試做價）"
                  />
                </div>
              </div>

              {/* 其他服務欄位 */}
              <div>
                <label className="mb-1 block text-sm font-medium">{FIELD_LABELS['effect']}</label>
                <textarea
                  value={formData.effect}
                  onChange={(e) => setFormData((p) => ({ ...p, effect: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  placeholder="用逗號分隔，例如：緊緻肌膚、提升輪廓、減淡皺紋"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{FIELD_LABELS['suitable']}</label>
                <textarea
                  value={formData.suitable}
                  onChange={(e) => setFormData((p) => ({ ...p, suitable: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  placeholder="例如：面部鬆弛者、想要V臉效果的人士"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{FIELD_LABELS['unsuitable']}</label>
                <textarea
                  value={formData.unsuitable}
                  onChange={(e) => setFormData((p) => ({ ...p, unsuitable: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  placeholder="例如：孕婦、心臟病患者、皮膚發炎者"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{FIELD_LABELS['precaution']}</label>
                <textarea
                  value={formData.precaution}
                  onChange={(e) => setFormData((p) => ({ ...p, precaution: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  placeholder="例如：術後一週內避免做臉、避免日曬"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{FIELD_LABELS['duration']}</label>
                <input
                  type="text"
                  value={formData.duration}
                  onChange={(e) => setFormData((p) => ({ ...p, duration: e.target.value }))}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                  placeholder="例如：60-90 分鐘"
                />
              </div>

              {/* 步驟 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">步驟</label>
                  <button
                    type="button"
                    onClick={addStep}
                    className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--muted)]"
                  >
                    + 新增步驟
                  </button>
                </div>
                {formData.steps.length > 0 && (
                  <div className="space-y-2">
                    {formData.steps.map((step, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">
                          {index + 1}
                        </span>
                        <input
                          type="text"
                          value={step}
                          onChange={(e) => updateStep(index, e.target.value)}
                          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                          placeholder={`步驟 ${index + 1} 描述`}
                        />
                        <button
                          type="button"
                          onClick={() => removeStep(index)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          移除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* FAQ 項目 - 所有類型都可用 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">常見問題（建議填寫）</label>
              <button
                type="button"
                onClick={addFaqItem}
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs hover:bg-[var(--muted)]"
              >
                + 新增問題
              </button>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              用口語化方式提問，AI 會自動匹配並回答。例如：「做完會唔會紅？」、「幾耐做一次好？」
            </p>
            {formData.faqItems.length > 0 && (
              <div className="space-y-2">
                {formData.faqItems.map((item, index) => (
                  <div key={index} className="rounded-lg border border-[var(--border)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--muted-foreground)]">問題 {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeFaqItem(index)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        移除
                      </button>
                    </div>
                    <input
                      type="text"
                      value={item.question}
                      onChange={(e) => updateFaqItem(index, 'question', e.target.value)}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      placeholder="例如：做完會唔會紅？"
                    />
                    <textarea
                      value={item.answer}
                      onChange={(e) => updateFaqItem(index, 'answer', e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
                      placeholder="例如：部分人士做完後可能有輕微泛紅，一般 2-4 小時內消退。"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">內容 *</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData((p) => ({ ...p, content: e.target.value }))}
              rows={6}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              placeholder={formData.docType === 'SERVICE'
                ? '補充說明、療程特點、建議次數等（結構化欄位已包含主要資訊）'
                : '詳細內容，AI 會參考這些資訊來回答客戶...'}
              required
            />
            {formData.docType === 'SERVICE' && (
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                服務類型的主要資訊建議填寫在上方結構化欄位，AI 會優先使用
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-[var(--foreground)] px-4 py-2 text-sm text-[var(--background)] hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? '儲存中...' : formMode === 'edit' ? '更新' : '建立'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="text-[var(--muted-foreground)]">載入中...</p>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] p-8 text-center text-[var(--muted-foreground)]">
          <p>尚無知識文檔</p>
          <p className="mt-2 text-sm">新增產品、服務、FAQ 等資訊供 AI 參考</p>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => (
            <div key={doc.id} className="rounded-xl border border-[var(--border)] p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{doc.title}</h3>
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800">
                      {DOC_TYPE_LABELS[doc.docType || 'GENERAL']}
                    </span>
                    {doc.category && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                        {doc.category}
                      </span>
                    )}
                  </div>
                  {doc.aliases && doc.aliases.length > 0 && (
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      別名：{doc.aliases.join(', ')}
                    </p>
                  )}
                  {doc.docType === 'SERVICE' && (
                    <div className="mt-2 space-y-1 text-sm">
                      {doc.price && (
                        <p>
                          <span className="font-medium text-gray-600">價錢：</span>
                          {doc.discountPrice ? (
                            <>
                              <span className="line-through text-gray-400">{doc.price}</span>
                              <span className="ml-2 text-green-600 font-medium">{doc.discountPrice}</span>
                            </>
                          ) : (
                            doc.price
                          )}
                        </p>
                      )}
                      {doc.effect && <p><span className="font-medium text-gray-600">功效：</span>{doc.effect}</p>}
                      {doc.suitable && <p><span className="font-medium text-gray-600">適合：</span>{doc.suitable}</p>}
                      {doc.unsuitable && <p><span className="font-medium text-gray-600">不適合：</span>{doc.unsuitable}</p>}
                      {doc.precaution && <p><span className="font-medium text-gray-600">注意：</span>{doc.precaution}</p>}
                      {doc.duration && <p><span className="font-medium text-gray-600">時長：</span>{doc.duration}</p>}
                      {doc.steps && doc.steps.length > 0 && (
                        <div className="mt-2">
                          <p className="font-medium text-gray-600">步驟：</p>
                          <ol className="list-decimal list-inside space-y-1">
                            {doc.steps.map((step, idx) => (
                              <li key={idx}>{step}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  )}
                  {doc.faqItems && doc.faqItems.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-sm font-medium text-gray-600">常見問題：</p>
                      {doc.faqItems.map((item, idx) => (
                        <div key={idx} className="text-sm pl-2">
                          <p className="font-medium">Q: {item.question}</p>
                          <p className="text-[var(--muted-foreground)]">A: {item.answer}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-sm text-[var(--muted-foreground)] line-clamp-3 whitespace-pre-wrap">
                    {doc.content}
                  </p>
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    更新於 {new Date(doc.updatedAt).toLocaleString('zh-HK')}
                  </p>
                </div>
                <div className="ml-4 flex flex-col gap-1">
                  <button
                    onClick={() => openEdit(doc)}
                    className="rounded-lg px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                  >
                    編輯
                  </button>
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    刪除
                  </button>
                </div>
              </div>
            </div>
          ))}
          <p className="text-xs text-[var(--muted-foreground)]">共 {docs.length} 篇文檔</p>
        </div>
      )}
    </div>
  );
}