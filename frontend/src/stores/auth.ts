import { create } from "zustand";
import { api } from "@/lib/api";
import {
  clearAuthSession,
  getAuthToken,
  getStoredUser,
  setAuthSession,
  type AuthUser,
} from "@/lib/apiAuth";

interface AuthState {
  token: string;
  user: AuthUser | null;
  hydrated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: getAuthToken(),
  user: getStoredUser(),
  hydrated: false,

  login: async (username, password) => {
    const result = await api.login(username, password);
    setAuthSession(result.token, result.user);
    set({ token: result.token, user: result.user, hydrated: true });
  },

  register: async (username, password, displayName) => {
    const result = await api.register(username, password, displayName);
    setAuthSession(result.token, result.user);
    set({ token: result.token, user: result.user, hydrated: true });
  },

  logout: async () => {
    try {
      if (get().token) await api.logout();
    } finally {
      clearAuthSession();
      set({ token: "", user: null, hydrated: true });
    }
  },

  hydrate: async () => {
    const token = getAuthToken();
    if (!token) {
      clearAuthSession();
      set({ token: "", user: null, hydrated: true });
      return;
    }
    set({ token, user: getStoredUser() });
    try {
      const user = await api.me();
      setAuthSession(token, user);
      set({ token, user, hydrated: true });
    } catch {
      clearAuthSession();
      set({ token: "", user: null, hydrated: true });
    }
  },
}));
