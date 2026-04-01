const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/** Avoid infinite "登入中…" when API is down; browser fetch can hang a long time. */
const FETCH_TIMEOUT_MS = 25_000;

interface FetchOptions extends RequestInit {
  params?: Record<string, string>;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ApiError(
        408,
        `連線逾時（超過 ${FETCH_TIMEOUT_MS / 1000} 秒）。請確認 API 已啟動：${API_BASE}`,
      );
    }
    if (e instanceof TypeError) {
      throw new ApiError(
        0,
        `無法連接 API（${API_BASE}）。請確認已執行 pnpm dev:api，且根目錄 .env 的 NEXT_PUBLIC_API_URL 正確。`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;

  setToken(token: string | null) {
    this.accessToken = token;
    if (token) {
      localStorage.setItem('accessToken', token);
    } else {
      localStorage.removeItem('accessToken');
    }
  }

  getToken(): string | null {
    if (this.accessToken) return this.accessToken;
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('accessToken');
    }
    return this.accessToken;
  }

  private async tryRefresh(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;

    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return false;

      const tokens = await res.json();
      this.setToken(tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  async fetch<T = unknown>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const { params, headers: customHeaders, ...rest } = options;

    let url = `${API_BASE}/api${endpoint}`;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const doFetch = async () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...customHeaders as Record<string, string>,
      };

      const token = this.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      return fetchWithTimeout(url, { ...rest, headers });
    };

    let response = await doFetch();

    if (response.status === 401 && this.getToken()) {
      if (!this.refreshing) {
        this.refreshing = this.tryRefresh().finally(() => { this.refreshing = null; });
      }
      const refreshed = await this.refreshing;
      if (refreshed) {
        response = await doFetch();
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new ApiError(response.status, error.message || error.error || 'Request failed');
    }

    return response.json();
  }

  get<T = unknown>(endpoint: string, params?: Record<string, string>) {
    return this.fetch<T>(endpoint, { method: 'GET', params });
  }

  post<T = unknown>(endpoint: string, data?: unknown) {
    return this.fetch<T>(endpoint, { method: 'POST', body: JSON.stringify(data) });
  }

  patch<T = unknown>(endpoint: string, data?: unknown) {
    return this.fetch<T>(endpoint, { method: 'PATCH', body: JSON.stringify(data) });
  }

  delete<T = unknown>(endpoint: string) {
    return this.fetch<T>(endpoint, { method: 'DELETE' });
  }
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = new ApiClient();
