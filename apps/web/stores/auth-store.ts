import { create } from 'zustand';
import type { AuthUser, TokenPair } from '@ats/shared';
import { api } from '@/lib/api-client';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (tenantName: string, name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // Must start false: /login never calls fetchMe(), so true here left the button
  // disabled + "登入中..." forever and no POST /auth/login was sent.
  isLoading: false,

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const tokens = await api.post<TokenPair>('/auth/login', { email, password });
      api.setToken(tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);

      const res = await api.get<{ data: AuthUser }>('/auth/me');
      set({ user: res.data, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  register: async (tenantName, name, email, password) => {
    set({ isLoading: true });
    try {
      const tokens = await api.post<TokenPair>('/auth/register', {
        tenantName,
        name,
        email,
        password,
      });
      api.setToken(tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);

      const res = await api.get<{ data: AuthUser }>('/auth/me');
      set({ user: res.data, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: () => {
    api.setToken(null);
    localStorage.removeItem('refreshToken');
    set({ user: null });
  },

  fetchMe: async () => {
    set({ isLoading: true });
    try {
      const res = await api.get<{ data: AuthUser }>('/auth/me');
      set({ user: res.data, isLoading: false });
    } catch {
      api.setToken(null);
      set({ user: null, isLoading: false });
    }
  },
}));
