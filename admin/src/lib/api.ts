const STORAGE_KEY = "vibe_trading_api_auth_key";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface AuthUser {
  user_id: number;
  username: string;
  display_name: string;
  created_at: string;
}

export interface AdminUsageSummary {
  total_users: number;
  total_sessions: number;
  total_messages: number;
  total_attempts: number;
  completed_attempts: number;
  failed_attempts: number;
  running_attempts: number;
  total_strategies: number;
}

export interface AdminUserUsageRow {
  user_id: number | null;
  username: string;
  display_name: string;
  session_count: number;
  message_count: number;
  attempt_count: number;
  completed_attempt_count: number;
  failed_attempt_count: number;
  running_attempt_count: number;
  strategy_count: number;
  last_session_at: string;
  last_message_at: string;
}

export interface AdminDashboardResponse {
  summary: AdminUsageSummary;
  users: AuthUser[];
  usage: AdminUserUsageRow[];
}

export interface AdminUserUpdateRequest {
  display_name?: string;
  password?: string;
  revoke_tokens?: boolean;
}

export interface StrategyMarketAdminItem {
  id: string;
  kind: "built-in" | "paid" | string;
  enabled: boolean;
  featured: boolean;
  price: string;
  status: "draft" | "published" | "archived" | string;
  note: string;
  updated_at: string;
}

export interface StrategyMarketAdminResponse {
  items: StrategyMarketAdminItem[];
}

export type JsonObject = Record<string, unknown>;

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) || "";
}

export function setApiKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, trimmed);
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  let detail = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    detail = body.detail || body.message || detail;
  } catch {
    // Preserve status-only errors for non-JSON responses.
  }
  return new ApiError(detail, response.status);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const apiKey = getApiKey();
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);

  const response = await fetch(`/api/vibe${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });

  if (!response.ok) throw await errorFromResponse(response);
  const text = await response.text();
  return text ? JSON.parse(text) as T : {} as T;
}

export const api = {
  getAdminDashboard: () => request<AdminDashboardResponse>("/admin/dashboard"),
  updateAdminUser: (userId: number, body: AdminUserUpdateRequest) =>
    request<AuthUser>(`/admin/users/${encodeURIComponent(String(userId))}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAdminUser: (userId: number) =>
    request<{ status: string; user_id: number }>(`/admin/users/${encodeURIComponent(String(userId))}`, {
      method: "DELETE",
    }),
  getAdminStrategyMarket: () => request<StrategyMarketAdminResponse>("/admin/strategy-market"),
  updateAdminStrategyMarket: (items: StrategyMarketAdminItem[]) =>
    request<StrategyMarketAdminResponse>("/admin/strategy-market", {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),
  getLLMSettings: () => request<JsonObject>("/settings/llm"),
  updateLLMSettings: (settings: JsonObject) =>
    request<JsonObject>("/settings/llm", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getDataSourceSettings: () => request<JsonObject>("/settings/data-sources"),
  updateDataSourceSettings: (settings: JsonObject) =>
    request<JsonObject>("/settings/data-sources", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
};
