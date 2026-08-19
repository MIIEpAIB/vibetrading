import { authHeaders, operatorAuthHeaders, withAuthQuery } from "@/lib/apiAuth";
import type { AuthUser } from "@/lib/apiAuth";

const BASE = "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const AUTH_REQUIRED_MESSAGE =
  "Please log in to access your workspace. Operator-only settings still require the server API key.";

export function isAuthRequiredError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function isGenericAuthDetail(detail: string): boolean {
  const normalized = detail.trim().toLowerCase();
  return normalized === "http 401"
    || normalized === "http 403"
    || normalized === "not authenticated"
    || normalized === "invalid or missing api key"
    || normalized === "invalid or missing operator api key"
    || normalized === "missing authorization header"
    || normalized === "missing bearer token";
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    detail = body.detail || body.message || detail;
  } catch { /* ignore */ }
  if ((res.status === 401 || res.status === 403) && isGenericAuthDetail(detail)) {
    detail = AUTH_REQUIRED_MESSAGE;
  }
  return new ApiError(detail, res.status);
}

async function request<T>(
  path: string,
  options?: RequestInit,
  authHeaderFactory: () => Record<string, string> = authHeaders,
): Promise<T> {
  const { headers, ...rest } = options ?? {};
  const mergedHeaders: Record<string, string> = { "Content-Type": "application/json", ...authHeaderFactory() };
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      mergedHeaders[key] = value;
    });
  }
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: mergedHeaders,
  });
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  const text = await res.text();
  if (!text) {
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const contentType = res.headers.get("content-type") || "unknown content type";
    const isHtml = /^\s*(?:<!doctype|<html)\b/i.test(text);
    const detail = isHtml
      ? `Expected JSON from ${path}, but received the app HTML shell. Check that API routes are proxied to the backend.`
      : `Expected JSON from ${path}, but received ${contentType}.`;
    throw new ApiError(detail, res.status);
  }
}

export interface UploadResult {
  status: string;
  file_path: string;
  filename: string;
}

async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/upload`, { method: "POST", headers: authHeaders(), body: form });
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  return res.json();
}

function appendQueryParam(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export const api = {
  register: (username: string, password: string, display_name?: string) =>
    request<AuthTokenResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, display_name }),
    }),
  login: (username: string, password: string) =>
    request<AuthTokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ status: string }>("/auth/logout", { method: "POST" }),
  me: () => request<AuthUser>("/auth/me"),
  changePassword: (current_password: string, new_password: string) =>
    request<{ status: string }>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),
  listExchangeApiKeys: () => request<ExchangeApiKeyBindingListResponse>("/auth/exchange-api-keys"),
  createExchangeApiKey: (body: CreateExchangeApiKeyBindingRequest) =>
    request<ExchangeApiKeyBinding>("/auth/exchange-api-keys", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteExchangeApiKey: (bindingId: number) =>
    request<{ status: string; binding_id: number }>(`/auth/exchange-api-keys/${encodeURIComponent(String(bindingId))}`, {
      method: "DELETE",
    }),
  activateExchangeApiKeyLive: (bindingId: number, checkConnection = false) =>
    request<CryptoLiveConfigureResponse>(
      `/auth/exchange-api-keys/${encodeURIComponent(String(bindingId))}/activate-live?check_connection=${encodeURIComponent(String(checkConnection))}`,
      { method: "POST" },
    ),
  uploadFile,
  listRuns: () => request<RunListItem[]>("/runs"),
  getRun: (id: string) => request<RunData>(`/runs/${id}`),
  getRunCode: (id: string) => request<Record<string, string>>(`/runs/${id}/code`),
  getRunPine: (id: string) => request<PineScriptResult>(`/runs/${id}/pine`),
  listSessions: () => request<SessionItem[]>("/sessions"),
  createSession: (title?: string) => request<SessionItem>("/sessions", { method: "POST", body: JSON.stringify({ title: title || "" }) }),
  deleteSession: (sid: string) => request<{ status: string }>(`/sessions/${sid}`, { method: "DELETE" }),
  renameSession: (sid: string, title: string) => request<{ status: string }>(`/sessions/${sid}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  sendMessage: (sid: string, content: string) => request<{ message_id: string; attempt_id: string }>(`/sessions/${sid}/messages`, { method: "POST", body: JSON.stringify({ content }) }),
  draftSessionStrategy: (sid: string) =>
    request<SessionStrategyDraftResponse>(`/sessions/${encodeURIComponent(sid)}/strategies/draft`),
  saveSessionStrategy: (sid: string, body: SaveSessionStrategyRequest) =>
    request<StrategyLibraryItem>(`/sessions/${encodeURIComponent(sid)}/strategies`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelSession: (sid: string) => request<{ status: string }>(`/sessions/${sid}/cancel`, { method: "POST" }),
  getSessionMessages: (sid: string) => request<MessageItem[]>(`/sessions/${sid}/messages`),
  createGoal: (sid: string, body: CreateGoalRequest) =>
    request<GoalSnapshot>(`/sessions/${sid}/goal`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getGoal: (sid: string) => request<GoalSnapshot>(`/sessions/${sid}/goal`),
  updateGoal: (sid: string, body: UpdateGoalRequest) =>
    request<UpdateGoalResponse>(`/sessions/${sid}/goal`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  addGoalEvidence: (sid: string, body: AddGoalEvidenceRequest) =>
    request<AddGoalEvidenceResponse>(`/sessions/${sid}/goal/evidence`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateGoalStatus: (sid: string, body: UpdateGoalStatusRequest) =>
    request<UpdateGoalStatusResponse>(`/sessions/${sid}/goal/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listStrategies: () => request<StrategyLibraryResponse>("/api/strategies"),
  replaceStrategies: (strategies: StrategyLibraryItem[]) =>
    request<StrategyLibraryResponse>("/api/strategies", {
      method: "PUT",
      body: JSON.stringify({ strategies }),
    }),
  upsertStrategy: (strategy: StrategyLibraryItem) =>
    request<StrategyLibraryItem>(`/api/strategies/${encodeURIComponent(strategy.id)}`, {
      method: "PUT",
      body: JSON.stringify(strategy),
    }),
  listStrategyVersions: (strategyId: string) =>
    request<StrategyVersionItem[]>(`/api/strategies/${encodeURIComponent(strategyId)}/versions`),
  deleteStrategy: (strategyId: string) =>
    request<{ status: string; id: string }>(`/api/strategies/${encodeURIComponent(strategyId)}`, {
      method: "DELETE",
    }),
  publishStrategy: (strategyId: string) =>
    request<PublicStrategyMarketItem>(`/api/strategies/${encodeURIComponent(strategyId)}/publish`, {
      method: "POST",
    }),
  listPublicStrategies: () => request<PublicStrategyMarketResponse>("/strategy-market/public"),
  runStrategyMarketBacktest: (body: StrategyMarketBacktestRequest) =>
    request<StrategyMarketBacktestResponse>("/strategy-market/backtest", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runStrategyBacktest: (strategyId: string, body: StrategyBacktestRequest = {}) =>
    request<StrategyMarketBacktestResponse>(`/api/strategies/${encodeURIComponent(strategyId)}/backtest`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createPaperDeployment: (body: CreatePaperDeploymentRequest) =>
    request<PaperDeploymentActionResponse>("/paper/deployments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listPaperDeployments: () => request<PaperDeploymentListResponse>("/paper/deployments"),
  getPaperDeploymentStatus: (deploymentId: string) =>
    request<PaperDeploymentStatusResponse>(`/paper/deployments/${encodeURIComponent(deploymentId)}`),
  startPaperDeployment: (deploymentId: string) =>
    request<PaperDeploymentActionResponse>(`/paper/deployments/${encodeURIComponent(deploymentId)}/start`, {
      method: "POST",
    }),
  pausePaperDeployment: (deploymentId: string) =>
    request<PaperDeploymentActionResponse>(`/paper/deployments/${encodeURIComponent(deploymentId)}/pause`, {
      method: "POST",
    }),
  resumePaperDeployment: (deploymentId: string) =>
    request<PaperDeploymentActionResponse>(`/paper/deployments/${encodeURIComponent(deploymentId)}/resume`, {
      method: "POST",
    }),
  archivePaperDeployment: (deploymentId: string) =>
    request<PaperDeploymentActionResponse>(`/paper/deployments/${encodeURIComponent(deploymentId)}/archive`, {
      method: "POST",
    }),
  runPaperDeploymentTick: (deploymentId: string) =>
    request<PaperTickResponse>(`/paper/deployments/${encodeURIComponent(deploymentId)}/tick`, {
      method: "POST",
    }),
  sseUrl: (sid: string, options?: { replay?: "active" }) => {
    let url = withAuthQuery(`${BASE}/sessions/${sid}/events`);
    if (options?.replay) url = appendQueryParam(url, "replay", options.replay);
    return url;
  },

  // Swarm API
  listSwarmPresets: () => request<SwarmPreset[]>("/swarm/presets"),
  createSwarmRun: (preset_name: string, user_vars: Record<string, string>) =>
    request<{ id: string; status: string }>("/swarm/runs", {
      method: "POST",
      body: JSON.stringify({ preset_name, user_vars }),
    }),
  listSwarmRuns: () => request<SwarmRunSummary[]>("/swarm/runs"),
  getSwarmRun: (id: string) => request<Record<string, unknown>>(`/swarm/runs/${id}`),
  swarmSseUrl: (id: string) => withAuthQuery(`${BASE}/swarm/runs/${id}/events`),
  cancelSwarmRun: (id: string) =>
    request<{ status: string }>(`/swarm/runs/${id}/cancel`, { method: "POST" }),
  retrySwarmRun: (id: string) =>
    request<{ id: string; status: string; preset_name: string }>(`/swarm/runs/${id}/retry`, { method: "POST" }),
  getLLMSettings: () => request<LLMSettings>("/settings/llm", undefined, operatorAuthHeaders),
  updateLLMSettings: (settings: UpdateLLMSettingsRequest) =>
    request<LLMSettings>("/settings/llm", {
      method: "PUT",
      body: JSON.stringify(settings),
    }, operatorAuthHeaders),
  getDataSourceSettings: () => request<DataSourceSettings>("/settings/data-sources", undefined, operatorAuthHeaders),
  updateDataSourceSettings: (settings: UpdateDataSourceSettingsRequest) =>
    request<DataSourceSettings>("/settings/data-sources", {
      method: "PUT",
      body: JSON.stringify(settings),
    }, operatorAuthHeaders),
  getAdminDashboard: () => request<AdminDashboardResponse>("/admin/dashboard", undefined, operatorAuthHeaders),
  updateAdminUser: (userId: number, body: AdminUserUpdateRequest) =>
    request<AuthUser>(`/admin/users/${encodeURIComponent(String(userId))}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }, operatorAuthHeaders),
  deleteAdminUser: (userId: number) =>
    request<{ status: string; user_id: number }>(`/admin/users/${encodeURIComponent(String(userId))}`, {
      method: "DELETE",
    }, operatorAuthHeaders),
  getStrategyMarketCatalogConfig: () => request<StrategyMarketAdminResponse>("/strategy-market/catalog"),
  getAdminStrategyMarket: () => request<StrategyMarketAdminResponse>("/admin/strategy-market", undefined, operatorAuthHeaders),
  updateAdminStrategyMarket: (items: StrategyMarketAdminItem[]) =>
    request<StrategyMarketAdminResponse>("/admin/strategy-market", {
      method: "PUT",
      body: JSON.stringify({ items }),
    }, operatorAuthHeaders),

  // Alpha Zoo API
  listAlphas: (params: AlphaListParams = {}) => {
    const q = new URLSearchParams();
    if (params.zoo) q.set("zoo", params.zoo);
    if (params.theme) q.set("theme", params.theme);
    if (params.universe) q.set("universe", params.universe);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<AlphaListResponse>(`/alpha/list${qs ? `?${qs}` : ""}`);
  },
  getAlpha: (alphaId: string) =>
    request<AlphaDetailResponse>(`/alpha/${encodeURIComponent(alphaId)}`),
  createAlphaBench: (body: AlphaBenchRequest) =>
    request<{ status: string; job_id: string }>("/alpha/bench", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  alphaBenchStreamUrl: (jobId: string) =>
    withAuthQuery(`${BASE}/alpha/bench/${encodeURIComponent(jobId)}/stream`),
  createAlphaCompare: (body: AlphaCompareRequest) =>
    request<{ status: string; job_id: string }>("/alpha/compare", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  alphaCompareStreamUrl: (jobId: string) =>
    withAuthQuery(`${BASE}/alpha/compare/${encodeURIComponent(jobId)}/stream`),

  // Connector runtime channel — privileged surface actions (NOT agent tools).
  // commit is the ONLY action that writes a mandate; halt trips the kill switch.
  commitMandate: (body: CommitMandateRequest) =>
    request<CommitMandateResponse>("/mandate/commit", {
      method: "POST",
      body: JSON.stringify(body),
    }, operatorAuthHeaders),
  haltLive: (session_id?: string, broker?: string, reason?: string) =>
    request<HaltLiveResponse>("/live/halt", {
      method: "POST",
      body: JSON.stringify({ session_id, broker, reason }),
    }, operatorAuthHeaders),
  // Read the persistent runtime status across all authorized brokers (SPEC §7.5).
  // Polled by the RunnerStatus panel; a plain authenticated GET, never a chat message.
  getLiveStatus: () => request<LiveStatus>("/live/status", undefined, operatorAuthHeaders),
  configureCryptoLive: (body: CryptoLiveConfigureRequest) =>
    request<CryptoLiveConfigureResponse>("/live/crypto/configure", {
      method: "POST",
      body: JSON.stringify(body),
    }, operatorAuthHeaders),
  authorizeLive: (broker: string) =>
    request<LiveAuthorizeResponse>("/live/authorize", {
      method: "POST",
      body: JSON.stringify({ broker }),
    }, operatorAuthHeaders),
  createLiveDeployment: (body: CreateLiveDeploymentRequest) =>
    request<LiveDeploymentActionResponse>("/live/deployments", {
      method: "POST",
      body: JSON.stringify(body),
    }, operatorAuthHeaders),
  listLiveDeployments: () =>
    request<LiveDeploymentListResponse>("/live/deployments", undefined, operatorAuthHeaders),
  startLiveDeployment: (deploymentId: string) =>
    request<LiveDeploymentActionResponse>(`/live/deployments/${encodeURIComponent(deploymentId)}/start`, {
      method: "POST",
    }, operatorAuthHeaders),
  pauseLiveDeployment: (deploymentId: string) =>
    request<LiveDeploymentActionResponse>(`/live/deployments/${encodeURIComponent(deploymentId)}/pause`, {
      method: "POST",
    }, operatorAuthHeaders),
  // Start/stop the persistent runner (SPEC §7.5). Privileged surface actions, not agent tools.
  startLiveRunner: (broker: string) =>
    request<LiveRunnerResponse>("/live/runner/start", {
      method: "POST",
      body: JSON.stringify({ broker }),
    }, operatorAuthHeaders),
  stopLiveRunner: (broker: string) =>
    request<LiveRunnerResponse>("/live/runner/stop", {
      method: "POST",
      body: JSON.stringify({ broker }),
    }, operatorAuthHeaders),
  getCryptoMarkets: (limit = 13) =>
    request<CryptoMarketsResponse>(`/crypto/markets?limit=${encodeURIComponent(String(limit))}`),
  getCryptoSymbols: (exchange: "okx" | "binance", productType: "spot" | "usdm_futures", limit = 500) => {
    const q = new URLSearchParams({ exchange, product_type: productType, limit: String(limit) });
    return request<CryptoSymbolsResponse>(`/crypto/symbols?${q.toString()}`);
  },
  getCryptoKlines: (symbol: string, timeframe = "1h", limit = 180) => {
    const q = new URLSearchParams({ symbol, timeframe, limit: String(limit) });
    return request<CryptoKlinesResponse>(`/crypto/klines?${q.toString()}`);
  },
  getCryptoKlineStreamUrl: (symbol: string, timeframe = "1h") => {
    const path = withAuthQuery(`/crypto/stream?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
    if (typeof window === "undefined") return path;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${path}`;
  },
  getShadowAccount: () => request<ShadowAccountResponse>("/shadow/account"),
  listShadowOrders: () => request<ShadowOrder[]>("/shadow/orders"),
  placeShadowOrder: (body: ShadowPlaceOrderRequest) =>
    request<ShadowOrder>("/shadow/orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelShadowOrder: (orderId: string) =>
    request<ShadowOrder>(`/shadow/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: "POST",
    }),
  updateShadowMarketPrice: (body: ShadowMarketPriceRequest) =>
    request<ShadowMarketPriceResponse>("/shadow/market-price", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  resetShadowAccount: () => request<ShadowAccountResponse>("/shadow/reset", { method: "POST" }),
  searchDirectMessageUsers: (query = "") => {
    const q = new URLSearchParams();
    if (query.trim()) q.set("query", query.trim());
    const qs = q.toString();
    return request<DirectMessageUserSearchResponse>(`/dm/users${qs ? `?${qs}` : ""}`);
  },
  listDirectMessageThreads: () => request<DirectMessageThreadListResponse>("/dm/threads"),
  createDirectMessageThread: (body: CreateDirectMessageThreadRequest) =>
    request<DirectMessageThread>("/dm/threads", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listDirectMessages: (threadId: string, limit = 100) =>
    request<DirectMessageListResponse>(`/dm/threads/${encodeURIComponent(threadId)}/messages?limit=${encodeURIComponent(String(limit))}`),
  sendDirectMessage: (threadId: string, content: string) =>
    request<DirectMessage>(`/dm/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  markDirectMessageThreadRead: (threadId: string) =>
    request<{ status: string; updated: number }>(`/dm/threads/${encodeURIComponent(threadId)}/read`, { method: "POST" }),
  searchSocialUsers: (query = "") => {
    const q = new URLSearchParams();
    if (query.trim()) q.set("query", query.trim());
    const qs = q.toString();
    return request<SocialUserSearchResponse>(`/social/users${qs ? `?${qs}` : ""}`);
  },
  getSocialUser: (userId: number) => request<SocialUser>(`/social/users/${encodeURIComponent(String(userId))}`),
  followUser: (userId: number) => request<SocialUser>(`/social/follows/${encodeURIComponent(String(userId))}`, { method: "POST" }),
  unfollowUser: (userId: number) => request<SocialUser>(`/social/follows/${encodeURIComponent(String(userId))}`, { method: "DELETE" }),
  listFollowing: (userId?: number) =>
    request<SocialUserSearchResponse>(`/social/following${userId ? `?user_id=${encodeURIComponent(String(userId))}` : ""}`),
  listFollowers: (userId?: number) =>
    request<SocialUserSearchResponse>(`/social/followers${userId ? `?user_id=${encodeURIComponent(String(userId))}` : ""}`),
};

export interface DirectMessageUser {
  user_id: number;
  username: string;
  display_name: string;
}

export interface SocialUser extends DirectMessageUser {
  follower_count: number;
  following_count: number;
  is_following: boolean;
}

export interface SocialUserSearchResponse {
  users: SocialUser[];
}

export interface DirectMessage {
  message_id: string;
  thread_id: string;
  sender: DirectMessageUser;
  content: string;
  created_at: string;
  read_by_current_user: boolean;
}

export interface DirectMessageThread {
  thread_id: string;
  peer: DirectMessageUser;
  created_at: string;
  updated_at: string;
  unread_count: number;
  last_message?: DirectMessage | null;
}

export interface DirectMessageThreadListResponse {
  threads: DirectMessageThread[];
}

export interface DirectMessageListResponse {
  messages: DirectMessage[];
}

export interface DirectMessageUserSearchResponse {
  users: DirectMessageUser[];
}

export interface CreateDirectMessageThreadRequest {
  recipient_user_id?: number;
  recipient_username?: string;
  initial_message?: string;
}

// --- Swarm types ---

export interface SwarmPreset {
  name: string;
  title: string;
  description: string;
  agent_count: number;
  variables: { name: string; description: string; required: boolean }[];
}

export interface SwarmRunSummary {
  id: string;
  preset_name: string;
  status: string;
  created_at: string;
  task_count: number;
  completed_count: number;
}

export interface AdminUsageSummary {
  total_users: number;
  total_sessions: number;
  total_messages: number;
  total_attempts: number;
  running_attempts: number;
  failed_attempts: number;
  completed_attempts: number;
  total_strategies: number;
}

export interface AdminUserUsageRow {
  user_id: number | null;
  username: string;
  display_name: string;
  session_count: number;
  message_count: number;
  attempt_count: number;
  running_attempt_count: number;
  failed_attempt_count: number;
  completed_attempt_count: number;
  strategy_count: number;
  last_session_at?: string | null;
  last_message_at?: string | null;
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
  kind: "built-in" | "paid" | "community";
  enabled: boolean;
  featured: boolean;
  price: string;
  status: "draft" | "submitted" | "published" | "rejected" | "hidden" | "archived";
  note: string;
  updated_at: string;
  name?: string;
  summary?: string;
  description?: string;
  strategy_description?: string;
  language?: string;
  category?: string;
  tags?: string[];
  code_snapshot?: string;
  published_at?: string;
  backtest_summary?: Record<string, unknown>;
  risk_warnings?: string[];
  owner_user_id?: number | null;
  source_strategy_id?: string;
  deleted?: boolean;
}

export interface StrategyMarketAdminResponse {
  items: StrategyMarketAdminItem[];
}

export interface LLMProviderOption {
  name: string;
  label: string;
  api_key_env?: string | null;
  base_url_env: string;
  default_model: string;
  default_base_url: string;
  api_key_required: boolean;
  auth_type?: string;
  login_command?: string | null;
}

export interface CryptoMarketAggregate {
  market_cap: number;
  volume_24h: number;
  open_interest: number;
  liquidation_24h: number;
  avg_change_24h: number;
  btc_dominance: number;
}

export interface CryptoMarketRow {
  rank: number;
  symbol: string;
  base: string;
  name: string;
  icon_url: string;
  icon_bg: string;
  icon_fg: string;
  price: number;
  change_24h: number;
  high_24h: number;
  low_24h: number;
  volume_24h: number;
  quote_volume_24h: number;
  market_cap: number;
  funding_rate: number;
  open_interest: number;
  liquidation_24h: number;
}

export interface CryptoMarketsResponse {
  status: string;
  source: string;
  updated_at: string;
  symbols: string[];
  aggregate: CryptoMarketAggregate;
  rows: CryptoMarketRow[];
}

export interface CryptoSymbolOption {
  symbol: string;
  display: string;
  base: string;
  quote: string;
  market_type: string;
}

export interface CryptoSymbolsResponse {
  status: string;
  source: string;
  exchange: "okx" | "binance";
  product_type: "spot" | "usdm_futures";
  symbols: CryptoSymbolOption[];
}

export interface CryptoStorageStatus {
  redis: string;
  timescale: string;
  detail?: string;
}

export interface CryptoKlineBar {
  time: string;
  timestamp: number;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CryptoKlinesResponse {
  status: string;
  symbol: string;
  timeframe: string;
  source: string;
  updated_at: string;
  storage: CryptoStorageStatus;
  bars: CryptoKlineBar[];
}

export interface ShadowWallet {
  user_id: string;
  account_type: "VIRTUAL" | "REAL" | string;
  asset_name: string;
  balance: number;
  frozen: number;
  equity: number;
}

export interface ShadowOrder {
  order_id: string;
  user_id: string;
  account_type: "VIRTUAL" | "REAL" | string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "TRIGGER";
  price: number;
  quantity: number;
  time_in_force?: "GTC" | "IOC" | "FOK" | "POST_ONLY" | string;
  status: "PENDING" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "EXPIRED" | "REJECTED";
  executed_price: number;
  average_price?: number;
  filled_quantity?: number;
  remaining_quantity?: number;
  executed_value?: number;
  reserved_asset: string;
  reserved_amount: number;
  fee_asset?: string;
  fee_paid?: number;
  trigger_price?: number;
  trigger_condition?: "GTE" | "LTE" | string;
  trigger_order_type?: "MARKET" | "LIMIT" | string;
  trigger_order_price?: number;
  triggered_at?: number;
  rejection_reason?: string;
  timestamp: number;
  updated_at: number;
}

export interface ShadowAccountResponse {
  account_cookie: string;
  portfolio_cookie: string;
  account_type: string;
  cash: number;
  frozen: number;
  market_value: number;
  total_asset: number;
  accounts: Record<string, {
    account_cookie: string;
    asset: string;
    balance: number;
    frozen: number;
    available: number;
    equity: number;
  }>;
  positions: Record<string, Record<string, unknown>>;
  orders: QIFIOrder[];
  trades: QIFITrade[];
  market_prices: Record<string, number>;
  updated_at: string;
}

export interface QIFIOrder {
  order_id: string;
  account_cookie: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  order_type: string;
  status: string;
  datetime: string;
  filled_quantity: number;
  avg_price: number;
  commission: number;
  metadata: Record<string, unknown>;
}

export interface QIFITrade {
  trade_id: string;
  order_id: string;
  account_cookie: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  datetime: string;
  commission: number;
  pnl: number;
  metadata: Record<string, unknown>;
}

export interface ShadowPlaceOrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  order_type: "MARKET" | "LIMIT" | "TRIGGER";
  quantity: number;
  price?: number;
  time_in_force?: "GTC" | "IOC" | "FOK" | "POST_ONLY";
  trigger_price?: number;
  trigger_condition?: "GTE" | "LTE";
  trigger_order_type?: "MARKET" | "LIMIT";
  trigger_order_price?: number;
}

export interface ShadowMarketPriceRequest {
  symbol: string;
  price: number;
}

export interface ShadowMarketPriceResponse {
  symbol: string;
  price: number;
  filled_orders: ShadowOrder[];
  account: ShadowAccountResponse;
}

export interface PaperLimits {
  symbols: string[];
  allowed_sides: Array<"BUY" | "SELL" | string>;
  max_order_notional: number;
  max_total_exposure: number;
  max_trades_per_day: number;
  min_cash_buffer: number;
  default_order_notional: number;
  order_type: "MARKET" | "LIMIT" | string;
}

export interface StrategySnapshot {
  strategy_id: string;
  name: string;
  description: string;
  language: string;
  category: string;
  tags: string[];
  code: string;
  source_updated_at: string;
  version: string;
}

export interface PaperDeployment {
  deployment_id: string;
  user_id: number;
  status: "draft" | "running" | "paused" | "archived" | string;
  strategy_id: string;
  strategy_snapshot: StrategySnapshot;
  limits: PaperLimits;
  execution_mode?: "shadow" | "broker_paper" | string;
  connector_profile_id?: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  paused_at?: string | null;
  archived_at?: string | null;
  last_tick_at?: string | null;
}

export interface PaperSignal {
  signal_id: string;
  deployment_id: string;
  user_id: number;
  strategy_version: string;
  symbol: string;
  action: "BUY" | "SELL" | "HOLD" | string;
  reason: string;
  data_timestamp: string;
  created_at: string;
  confidence?: number | null;
  target_weight?: number | null;
  quantity?: number | null;
  notional?: number | null;
  limit_price?: number | null;
  metadata: Record<string, unknown>;
}

export interface PaperRiskDecision {
  decision_id: string;
  deployment_id: string;
  signal_id: string;
  user_id: number;
  decision: "allowed" | "rejected" | string;
  reason: string;
  created_at: string;
  breached_limit: string;
  order_notional: number;
  price: number;
  quantity: number;
}

export interface PaperOrderLink {
  link_id: string;
  deployment_id: string;
  signal_id: string;
  decision_id: string;
  user_id: number;
  shadow_order_id: string;
  shadow_status: ShadowOrder["status"] | string;
  created_at: string;
  rejection_reason: string;
  execution_mode?: "shadow" | "broker_paper" | string;
  connector_profile_id?: string;
  broker_order_id?: string;
  broker_payload?: Record<string, unknown>;
}

export interface PaperTick {
  tick_id: string;
  deployment_id: string;
  user_id: number;
  outcome: "no_action" | "failed" | "rejected" | "order_placed" | string;
  created_at: string;
  reason: string;
  signal_id?: string | null;
  decision_id?: string | null;
  shadow_order_id?: string | null;
}

export interface CreatePaperDeploymentRequest {
  strategy_id: string;
  limits: Partial<PaperLimits>;
  execution_mode?: "shadow" | "broker_paper";
  connector_profile_id?: string;
}

export interface PaperDeploymentActionResponse {
  deployment: PaperDeployment;
}

export interface PaperDeploymentListResponse {
  deployments: PaperDeployment[];
}

export interface PaperDeploymentStatusResponse {
  deployment: PaperDeployment;
  latest_tick?: PaperTick | null;
  recent_ticks: PaperTick[];
  recent_signals: PaperSignal[];
  recent_decisions: PaperRiskDecision[];
  recent_orders: PaperOrderLink[];
  summary: {
    tick_count?: number;
    order_count?: number;
    rejected_decision_count?: number;
    filled_order_count?: number;
    [key: string]: number | undefined;
  };
}

export interface PaperTickResponse {
  tick: PaperTick;
  signal?: PaperSignal | null;
  decision?: PaperRiskDecision | null;
  order_link?: PaperOrderLink | null;
}

export interface LLMSettings {
  provider: string;
  model_name: string;
  base_url: string;
  api_key_env?: string | null;
  api_key_configured: boolean;
  api_key_hint?: string | null;
  api_key_required: boolean;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  reasoning_effort: string;
  sse_timeout_seconds: number;
  env_path: string;
  providers: LLMProviderOption[];
}

export interface UpdateLLMSettingsRequest {
  provider: string;
  model_name: string;
  base_url: string;
  api_key?: string;
  clear_api_key?: boolean;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  reasoning_effort?: string;
}

export interface DataSourceSettings {
  tushare_token_configured: boolean;
  tushare_token_hint?: string | null;
  baostock_supported: boolean;
  baostock_installed: boolean;
  baostock_message: string;
  env_path: string;
}

export interface UpdateDataSourceSettingsRequest {
  tushare_token?: string;
  clear_tushare_token?: boolean;
}

// --- Types matching backend API contracts ---

export interface AuthTokenResponse {
  token: string;
  token_type: "bearer";
  expires_at: string;
  user: AuthUser;
}

export interface ExchangeApiKeyBinding {
  binding_id: number;
  exchange: "okx" | "binance";
  label: string;
  api_key_hint: string;
  api_secret_configured: boolean;
  passphrase_configured: boolean;
  product_type: "spot" | "usdm_futures";
  margin_mode: "cross" | "isolated";
  created_at: string;
  updated_at: string;
}

export interface ExchangeApiKeyBindingListResponse {
  bindings: ExchangeApiKeyBinding[];
}

export interface SaveSessionStrategyRequest {
  name: string;
  description?: string;
  strategyDescription?: string;
  language?: "python" | "javascript";
  category?: string;
  tags?: string[];
  code: string;
  message_id?: string;
}

export interface SessionStrategyDraftResponse extends SaveSessionStrategyRequest {
  source_message_id?: string;
}

export interface CreateExchangeApiKeyBindingRequest {
  exchange: "okx" | "binance";
  label?: string;
  api_key: string;
  api_secret: string;
  passphrase?: string;
  product_type?: "spot" | "usdm_futures";
  margin_mode?: "cross" | "isolated";
}

export interface RunListItem {
  run_id: string;
  status: string;
  created_at: string;
  prompt?: string;
  total_return?: number;
  sharpe?: number;
  codes?: string[];
  start_date?: string;
  end_date?: string;
}

export interface PriceBar {
  time: string;
  timestamp?: string;
  code?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeMarker {
  time: string;
  timestamp?: string;
  code?: string;
  side: "BUY" | "SELL";
  price: number;
  qty?: number;
  reason?: string;
  text?: string;
}

export interface EquityPoint {
  time: string;
  equity: string | number;
  drawdown: string | number;
}

export interface ValidationData {
  monte_carlo?: {
    actual_sharpe: number;
    actual_max_dd: number;
    p_value_sharpe: number;
    p_value_max_dd: number;
    simulated_sharpe_mean: number;
    simulated_sharpe_std: number;
    simulated_sharpe_p5: number;
    simulated_sharpe_p95: number;
    n_simulations: number;
    n_trades: number;
    error?: string;
  };
  bootstrap?: {
    observed_sharpe: number;
    ci_lower: number;
    ci_upper: number;
    median_sharpe: number;
    prob_positive: number;
    confidence: number;
    n_bootstrap: number;
    error?: string;
  };
  walk_forward?: {
    n_windows: number;
    windows: Array<{
      window: number;
      start: string;
      end: string;
      return: number;
      sharpe: number;
      max_dd: number;
      trades: number;
      win_rate: number;
    }>;
    profitable_windows: number;
    consistency_rate: number;
    return_mean: number;
    return_std: number;
    sharpe_mean: number;
    sharpe_std: number;
    error?: string;
  };
}

export interface RunData {
  status: string;
  run_id: string;
  prompt?: string;
  elapsed_seconds?: number;
  run_directory?: string;
  run_stage?: string;
  run_context?: Record<string, unknown>;

  metrics?: BacktestMetrics;
  artifacts?: ArtifactInfo[];
  run_card?: RunCard;
  validation?: ValidationData;

  price_series?: Record<string, PriceBar[]>;
  indicator_series?: Record<string, Record<string, IndicatorPoint[]>>;
  trade_markers?: TradeMarker[];
  equity_curve?: EquityPoint[];
  trade_log?: Array<Record<string, string>>;
  run_logs?: Array<{ source?: string; line_number?: number; message?: string }>;
}

export interface RunCard {
  schema_version?: string;
  generated_at?: string;
  run_dir?: string;
  backtest?: Record<string, unknown>;
  reproducibility?: Record<string, unknown>;
  data_sources?: string[];
  metrics?: Record<string, unknown>;
  validation?: unknown;
  warnings?: string[];
  artifacts?: RunCardArtifact[];
  [key: string]: unknown;
}

export interface RunCardArtifact {
  path: string;
  size_bytes: number;
  sha256: string;
}

export interface BacktestMetrics {
  final_value: number;
  total_return: number;
  annual_return: number;
  max_drawdown: number;
  sharpe: number;
  win_rate: number;
  trade_count: number;
  [key: string]: number;
}

export interface StrategyMarketBacktestRequest {
  strategy_id: string;
  start_date?: string;
  end_date?: string;
  symbol?: string;
  interval?: string;
  source?: string;
  exchange?: string;
  mode?: string;
  quote_currency?: string;
  initial_capital?: number;
  trading_currency?: string;
  parameters?: Record<string, unknown>;
}

export interface StrategyBacktestRequest {
  start_date?: string;
  end_date?: string;
  symbol?: string;
  interval?: string;
  source?: string;
  exchange?: string;
  mode?: string;
  quote_currency?: string;
  initial_capital?: number;
  trading_currency?: string;
  parameters?: Record<string, unknown>;
}

export interface StrategyMarketBacktestResponse {
  strategy_id: string;
  status: "passed" | "failed";
  run_id: string;
  run_directory: string;
  symbol: string;
  timeframe: string;
  period: string;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  winRatePct: number;
  tradeCount: number;
  engine: string;
  assumptions: string[];
  warnings: string[];
}


export interface IndicatorPoint {
  time: string;
  value: number;
}

export interface ArtifactInfo {
  name: string;
  path: string;
  type: string;
  size: number;
  exists: boolean;
}

export interface PineScriptResult {
  exists: boolean;
  content: string | null;
}

export interface SessionItem {
  session_id: string;
  title?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  last_attempt_id?: string;
}

// --- Goal types ---

export type GoalStatus =
  | "active"
  | "paused"
  | "waiting_user"
  | "needs_refresh"
  | "insufficient_evidence"
  | "compliance_blocked"
  | "blocked"
  | "budget_limited"
  | "usage_limited"
  | "complete"
  | "cancelled"
  | "superseded";

export type GoalRiskTier =
  | "research_general"
  | "market_specific_short_term"
  | "personalized_advice_or_position_sizing";

export interface GoalRecord {
  goal_id: string;
  session_id: string;
  status: GoalStatus;
  objective: string;
  ui_summary: string;
  source: string;
  protocol: string;
  risk_tier: GoalRiskTier;
  token_budget?: number | null;
  tokens_used: number;
  turn_budget?: number | null;
  turns_used: number;
  time_budget_seconds?: number | null;
  time_used_seconds: number;
  budget_wrapup_sent: boolean;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  recap?: string | null;
}

export interface GoalClaim {
  claim_id: string;
  goal_id: string;
  session_id: string;
  claim_type: string;
  text: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface GoalCriterion {
  criterion_id: string;
  goal_id: string;
  session_id: string;
  text: string;
  required: boolean;
  status: string;
  freshness_requirement?: string | null;
  protocol_step?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalEvidence {
  evidence_id: string;
  goal_id: string;
  session_id: string;
  text: string;
  criterion_id?: string | null;
  claim_id?: string | null;
  evidence_type: string;
  tool_call_id?: string | null;
  run_id?: string | null;
  source_provider?: string | null;
  source_type?: string | null;
  source_uri?: string | null;
  symbol_universe: string[];
  benchmark: string[];
  timeframe?: string | null;
  method?: string | null;
  assumptions: Record<string, unknown>;
  artifact_path?: string | null;
  artifact_hash?: string | null;
  retrieved_at: string;
  data_as_of?: string | null;
  freshness_status: string;
  verification_status: string;
  confidence?: string | null;
  caveat?: string | null;
  contradicts_claim_ids: string[];
  created_at: string;
}

export interface GoalSnapshot {
  goal: GoalRecord;
  claims: GoalClaim[];
  criteria: GoalCriterion[];
  evidence: GoalEvidence[];
  evidence_count: number;
}

export interface CreateGoalRequest {
  objective: string;
  criteria?: string[];
  ui_summary?: string;
  protocol?: string;
  risk_tier?: GoalRiskTier;
  token_budget?: number;
  turn_budget?: number;
  time_budget_seconds?: number;
}

export interface AddGoalEvidenceRequest {
  goal_id: string;
  expected_goal_id: string;
  text: string;
  criterion_id?: string | null;
  claim_id?: string | null;
  evidence_type?: string;
  tool_call_id?: string | null;
  run_id?: string | null;
  source_provider?: string | null;
  source_type?: string | null;
  source_uri?: string | null;
  symbol_universe?: string[];
  benchmark?: string[];
  timeframe?: string | null;
  method?: string | null;
  assumptions?: Record<string, unknown>;
  artifact_path?: string | null;
  artifact_hash?: string | null;
  data_as_of?: string | null;
  confidence?: string | null;
  caveat?: string | null;
  contradicts_claim_ids?: string[];
}

export interface UpdateGoalRequest {
  goal_id: string;
  expected_goal_id: string;
  objective?: string;
  ui_summary?: string;
}

export interface UpdateGoalResponse {
  goal: GoalRecord;
  snapshot: GoalSnapshot;
}

export interface AddGoalEvidenceResponse {
  evidence: GoalEvidence;
  snapshot: GoalSnapshot;
}

export interface GoalAuditRowRequest {
  criterion_id: string;
  result: string;
  evidence_ids?: string[];
  notes?: string;
}

export interface UpdateGoalStatusRequest {
  goal_id: string;
  expected_goal_id: string;
  status: GoalStatus;
  audit?: GoalAuditRowRequest[];
  recap?: string | null;
}

export interface UpdateGoalStatusResponse {
  goal: GoalRecord;
  snapshot: GoalSnapshot;
}

export interface StrategyLibraryItem {
  id: string;
  name: string;
  description: string;
  strategyDescription?: string;
  language: string;
  category: string;
  status: string;
  tags: string[];
  code: string;
  createdAt: string;
  updatedAt: string;
  shareStatus?: "none" | "submitted" | "published" | "rejected" | "hidden" | "archived" | string;
}

export interface StrategyLibraryResponse {
  strategies: StrategyLibraryItem[];
}

export interface StrategyVersionItem {
  version: number;
  strategy_id: string;
  owner_user_id: number;
  name: string;
  description: string;
  strategyDescription?: string;
  language: string;
  category: string;
  tags: string[];
  code: string;
  code_sha256: string;
  createdAt: string;
}

export interface PublicStrategyMarketItem {
  publicId: string;
  sourceStrategyId: string;
  name: string;
  summary: string;
  description: string;
  strategyDescription?: string;
  language: string;
  category: string;
  tags: string[];
  codeSnapshot: string;
  reviewStatus: "published" | "submitted" | "rejected" | "hidden" | "archived";
  publishedAt: string;
  updatedAt: string;
  backtestSummary: Record<string, unknown>;
  riskWarnings: string[];
}

export interface PublicStrategyMarketResponse {
  strategies: PublicStrategyMarketItem[];
}

// --- Alpha Zoo types ---

export interface AlphaListParams {
  zoo?: string;
  theme?: string;
  universe?: string;
  limit?: number;
}

export interface AlphaSummary {
  id: string;
  zoo: string;
  theme: string[];
  universe: string[];
  nickname?: string;
  decay_horizon?: number | null;
  min_warmup_bars?: number | null;
  requires_sector?: boolean;
}

export interface AlphaListResponse {
  status: string;
  alphas: AlphaSummary[];
  total: number;
  returned: number;
  truncated: boolean;
}

export interface AlphaDetail {
  id: string;
  zoo: string;
  module_path?: string;
  meta: Record<string, unknown>;
}

export interface AlphaDetailResponse {
  status: string;
  alpha: AlphaDetail;
  source_code: string;
}

export interface AlphaBenchRequest {
  zoo: string;
  universe: string;
  period: string;
  top?: number;
}

export interface AlphaBenchTopRow {
  id: string;
  ic_mean: number;
  ir: number;
  theme: string[];
  formula_latex: string;
  category: "alive" | "reversed" | "dead";
}

export interface AlphaBenchResult {
  alive: number;
  reversed: number;
  dead: number;
  skipped?: number;
  top5_by_ir: AlphaBenchTopRow[];
  dead_examples: AlphaBenchTopRow[];
  by_theme: Record<string, { alive: number; reversed: number; dead: number }>;
}

export interface AlphaCompareRequest {
  alpha_ids: string[];
  universe: string;
  period: string;
  /** One of: ir | ic_mean | ic_positive_ratio | ic_count (default ir). */
  sort?: string;
}

export interface AlphaCompareRow {
  rank: number;
  id: string;
  zoo: string;
  ic_mean: number;
  ic_std: number;
  ir: number;
  ic_positive_ratio: number;
  ic_count: number;
  /** `delta_<sort>_vs_best` — gap to the top-ranked alpha on the active metric. */
  [deltaKey: string]: number | string;
}

export interface AlphaCompareSkip {
  id: string;
  reason: string;
}

export interface AlphaCompareResult {
  universe: string;
  period: string;
  sort: string;
  n_compared: number;
  n_skipped: number;
  winner: string;
  ranking: AlphaCompareRow[];
  skipped: AlphaCompareSkip[];
}

// --- Connector runtime channel types ---

/** One mandate profile inside a `mandate.proposal` event (SPEC Consent §1). */
export interface MandateProfile {
  ordinal: number;
  label: string;
  /** Concrete ticker list, or a structural universe descriptor (e.g. "tech_sector"). */
  universe: string[] | string;
  max_order_usd: number;
  daily_trade_cap: number;
  /** "none" for cash-only, otherwise a leverage descriptor/multiple. */
  leverage: string | number;
  instruments: string[];
  notes?: string;
}

/** Account block of a `mandate.proposal` event. */
export interface MandateProposalAccount {
  broker: string;
  type: string;
  funded_by: string;
}

/** Payload of the `mandate.proposal` SSE event (SPEC Consent §1). */
export interface MandateProposal {
  type?: string;
  proposal_id: string;
  session_id?: string;
  intent_normalized?: string;
  account?: MandateProposalAccount;
  ceilings_ref?: string;
  profiles: MandateProfile[];
  funding_note?: string;
  halt_note?: string;
  /** Present only when this proposal was triggered by a mandate breach (SPEC Consent §3). */
  reauth_for?: { breach_id?: string } | null;
}

/** Payload of the `mandate.committed` SSE event (SPEC Consent §1 COMMIT). */
export interface MandateCommitted {
  proposal_id?: string;
  mandate_id?: string;
  consent_record_id?: string;
  selected_ordinal?: number;
  broker?: string;
  /** Resolved limits, surfaced for the compact active-mandate badge. */
  max_order_usd?: number;
  daily_trade_cap?: number;
  expires_at?: string;
}

/** Payload of the `live.halted` SSE event (SPEC Consent §4). */
export interface LiveHalted {
  broker?: string | null;
  tripped_at?: string;
  by?: string;
  reason?: string;
}

/** Payload of the `live.action` SSE event (SPEC Consent §5 audit notify). */
export interface LiveAction {
  audit_id?: string;
  ts?: string;
  kind: string;
  intent_normalized?: string;
  outcome?: string;
  broker?: string;
  remote_tool?: string;
  error?: string | null;
}

export interface CommitMandateRequest {
  broker: string;
  proposal_id: string;
  selected_ordinal: number;
  /** Present only on the adjust path (SPEC Consent §3); null otherwise. */
  adjustments?: Record<string, unknown> | null;
  /** Explicit affirmative consent; the surface sets it on the user's click. */
  consent_ack: boolean;
  session_id?: string;
  account_ref?: string;
  lifetime_days?: number;
}

export interface CommitMandateResponse {
  mandate_id: string;
  consent_record_id: string;
  selected_ordinal?: number;
  broker?: string;
  max_order_usd?: number;
  daily_trade_cap?: number;
  expires_at?: string;
}

export interface HaltLiveResponse {
  halted: boolean;
  broker?: string | null;
  reason: string;
  sentinel: string;
}

export interface LiveAuthorizeRequest {
  broker: string;
}

export interface LiveAuthorizeResponse {
  broker: string;
  connector_profile: string;
  oauth_token_present: boolean;
  instruction: string;
  note?: string;
}

export interface CryptoLiveConfigureRequest {
  exchange: "okx" | "binance";
  product_type: "spot" | "usdm_futures";
  api_key: string;
  api_secret: string;
  passphrase?: string;
  margin_mode?: "cross" | "isolated";
  check_connection?: boolean;
}

export interface CryptoLiveConfigureResponse {
  status: string;
  exchange: string;
  product_type: string;
  profile_id: string;
  config_path: string;
  connection?: Record<string, unknown> | null;
}

/** Mandate limits surfaced inside a `GET /live/status` broker entry (SPEC §7.5). */
export interface LiveMandateLimits {
  max_order_notional_usd?: number;
  max_total_exposure_usd?: number;
  max_leverage?: number;
  max_trades_per_day?: number;
  allowed_instruments?: string[];
  account_funding_usd?: number;
  [key: string]: unknown;
}

/** Active mandate block of a `GET /live/status` broker entry. */
export interface LiveMandateStatus {
  broker?: string;
  mandate_id?: string;
  account_ref?: string;
  created_at?: string;
  limits?: LiveMandateLimits;
  /** ISO timestamp the mandate auto-expires (SPEC §7.5 #7 proactive expiry). */
  expires_at?: string;
  expires_in_seconds?: number | null;
  expired?: boolean;
}

/** Runner liveness block of a `GET /live/status` broker entry (SPEC §7.5 #3). */
export interface LiveRunnerLiveness {
  broker?: string;
  alive: boolean;
  /** Unix epoch seconds of the last heartbeat tick; null if the runner never started. */
  last_tick?: number | string | null;
  last_tick_age_seconds?: number | null;
}

export interface LiveBrokerAuthStatus {
  broker: string;
  oauth_token_present: boolean;
  is_live_broker: boolean;
}

/** One broker entry in the `GET /live/status` response. */
export interface LiveBrokerStatus {
  auth: LiveBrokerAuthStatus;
  mandate?: LiveMandateStatus | null;
  runner: LiveRunnerLiveness;
  halted: boolean;
}

/** Response of `GET /live/status` (SPEC §7.5 runner status panel + C2). */
export interface LiveStatus {
  brokers: LiveBrokerStatus[];
  global_halted: boolean;
}

export interface CreateLiveDeploymentRequest {
  strategy_id: string;
  broker: string;
  interval_seconds: number;
  session_id?: string;
  limits?: Record<string, unknown>;
}

export interface LiveDeployment {
  deployment_id: string;
  user_id?: number;
  status: "draft" | "running" | "paused" | "archived" | string;
  broker: string;
  strategy_id: string;
  strategy_snapshot?: {
    strategy_id?: string;
    name?: string;
    language?: string;
    category?: string;
    version?: string;
    source_updated_at?: string;
  };
  interval_seconds?: number;
  limits?: Record<string, unknown>;
  session_id?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  paused_at?: string | null;
  archived_at?: string | null;
}

export interface LiveDeploymentActionResponse {
  deployment: LiveDeployment;
  runner?: Record<string, unknown>;
}

export interface LiveDeploymentListResponse {
  deployments: LiveDeployment[];
}

/** Response of `POST /live/runner/start|stop`. */
export interface LiveRunnerResponse {
  broker: string;
  started?: boolean;
  already_running?: boolean;
  stopped?: boolean;
  was_running?: boolean;
}

export interface MessageItem {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  linked_attempt_id?: string;
  metadata?: Record<string, unknown>;
}
