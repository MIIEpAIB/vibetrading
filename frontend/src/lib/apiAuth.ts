const STORAGE_KEY = "vibe_trading_api_auth_key";
const TOKEN_STORAGE_KEY = "vibe_trading_auth_token";
const USER_STORAGE_KEY = "vibe_trading_auth_user";

export interface AuthUser {
  user_id: number;
  username: string;
  display_name: string;
  created_at: string;
}

export function getApiAuthKey(): string {
  return window.localStorage.getItem(STORAGE_KEY) || "";
}

export function setApiAuthKey(value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    window.localStorage.setItem(STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

export function getAuthToken(): string {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

export function setAuthSession(token: string, user: AuthUser): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearAuthSession(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(USER_STORAGE_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = window.localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    clearAuthSession();
    return null;
  }
}

export function authHeaders(): Record<string, string> {
  const key = getAuthToken() || getApiAuthKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export function operatorAuthHeaders(): Record<string, string> {
  const key = getApiAuthKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export function authQuerySuffix(): string {
  const key = getAuthToken() || getApiAuthKey();
  return key ? `api_key=${encodeURIComponent(key)}` : "";
}

export function withAuthQuery(url: string): string {
  const suffix = authQuerySuffix();
  if (!suffix) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${suffix}`;
}
