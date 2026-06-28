import type {
  AuthProvider,
  BaseRecord,
  CustomParams,
  DataProvider,
  DeleteOneParams,
  GetListParams,
  GetOneParams,
  UpdateParams,
} from "@refinedev/core";
import { api, ApiError, type AdminDashboardResponse, type AdminUserUpdateRequest, type StrategyMarketAdminItem } from "@/lib/api";
import { getApiAuthKey, setApiAuthKey, type AuthUser } from "@/lib/apiAuth";

const OPERATOR_LOGIN_PATH = "/operator/login";

function unsupported(resource: string, action: string): never {
  throw new Error(`Refine resource "${resource}" does not support ${action}.`);
}

function userRecord(user: AuthUser): BaseRecord {
  return { ...user, id: user.user_id };
}

function usageRecord(row: AdminDashboardResponse["usage"][number]): BaseRecord {
  return { ...row, id: row.user_id ?? "operator" };
}

function marketRecord(item: StrategyMarketAdminItem): BaseRecord {
  return { ...item, id: item.id };
}

export const adminResources = [
  { name: "admin-dashboard", list: "/operator" },
  { name: "admin-users", list: "/operator" },
  { name: "agent-usage", list: "/operator" },
  { name: "strategy-market", list: "/operator" },
];

export const adminAuthProvider: AuthProvider = {
  login: async ({ apiKey }: { apiKey?: string }) => {
    if (!apiKey?.trim()) {
      return { success: false, error: new Error("Operator API key is required.") };
    }
    setApiAuthKey(apiKey);
    return { success: true, redirectTo: "/operator" };
  },
  logout: async () => {
    setApiAuthKey("");
    return { success: true, redirectTo: OPERATOR_LOGIN_PATH };
  },
  check: async () => {
    if (getApiAuthKey()) return { authenticated: true };
    return { authenticated: false, redirectTo: OPERATOR_LOGIN_PATH, logout: true };
  },
  onError: async (error: unknown) => {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return { logout: true, redirectTo: OPERATOR_LOGIN_PATH, error };
    }
    return {};
  },
  getPermissions: async () => ["operator"],
  getIdentity: async () => ({
    id: "operator",
    name: "Operator",
  }),
};

export const adminDataProvider: DataProvider = {
  getApiUrl: () => "",
  getList: async <TData extends BaseRecord = BaseRecord>(params: GetListParams) => {
    const { resource } = params;
    if (resource === "admin-users") {
      const dashboard = await api.getAdminDashboard();
      return { data: dashboard.users.map(userRecord) as TData[], total: dashboard.users.length };
    }
    if (resource === "agent-usage") {
      const dashboard = await api.getAdminDashboard();
      return { data: dashboard.usage.map(usageRecord) as TData[], total: dashboard.usage.length };
    }
    if (resource === "strategy-market") {
      const market = await api.getAdminStrategyMarket();
      return { data: market.items.map(marketRecord) as TData[], total: market.items.length };
    }
    unsupported(resource, "getList");
  },
  getOne: async <TData extends BaseRecord = BaseRecord>(params: GetOneParams) => {
    const { resource, id } = params;
    if (resource === "admin-dashboard") {
      const dashboard = await api.getAdminDashboard();
      return { data: { ...dashboard, id: "summary" } as unknown as TData };
    }
    if (resource === "admin-users") {
      const dashboard = await api.getAdminDashboard();
      const user = dashboard.users.find((item) => item.user_id === Number(id));
      if (!user) throw new ApiError(`Admin user ${id} not found`, 404);
      return { data: userRecord(user) as TData };
    }
    if (resource === "strategy-market") {
      const market = await api.getAdminStrategyMarket();
      const item = market.items.find((entry) => entry.id === String(id));
      if (!item) throw new ApiError(`Strategy market item ${id} not found`, 404);
      return { data: marketRecord(item) as TData };
    }
    unsupported(resource, "getOne");
  },
  create: async ({ resource }) => unsupported(resource, "create"),
  update: async <TData extends BaseRecord = BaseRecord, TVariables = object>(params: UpdateParams<TVariables>) => {
    const { resource, id, variables } = params;
    if (resource === "admin-users") {
      const user = await api.updateAdminUser(Number(id), variables as AdminUserUpdateRequest);
      return { data: userRecord(user) as TData };
    }
    unsupported(resource, "update");
  },
  deleteOne: async <TData extends BaseRecord = BaseRecord, TVariables = object>(params: DeleteOneParams<TVariables>) => {
    const { resource, id } = params;
    if (resource === "admin-users") {
      await api.deleteAdminUser(Number(id));
      return { data: { id } as TData };
    }
    unsupported(resource, "deleteOne");
  },
  custom: async <TData extends BaseRecord = BaseRecord, TQuery = unknown, TPayload = unknown>(params: CustomParams<TQuery, TPayload>) => {
    const { url, method, payload } = params;
    if (url === "admin/dashboard" && method === "get") {
      return { data: await api.getAdminDashboard() as unknown as TData };
    }
    if (url === "admin/strategy-market" && method === "get") {
      return { data: await api.getAdminStrategyMarket() as unknown as TData };
    }
    if (url === "admin/strategy-market" && method === "put") {
      const body = payload as { items?: StrategyMarketAdminItem[] };
      return { data: await api.updateAdminStrategyMarket(body.items ?? []) as unknown as TData };
    }
    unsupported(url, `custom:${method}`);
  },
};
