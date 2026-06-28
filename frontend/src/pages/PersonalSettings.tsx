import { useEffect, useMemo, useState, type FormEvent } from "react";
import { KeyRound, Link2, Loader2, Save, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import { api, type ExchangeApiKeyBinding } from "@/lib/api";
import { useTranslation } from "@/i18n/I18nProvider";
import { useAuthStore } from "@/stores/auth";

type Exchange = "okx" | "binance";
type ProductType = "spot" | "usdm_futures";
type MarginMode = "cross" | "isolated";

const fieldClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-sm font-medium";

function emptyKeyForm() {
  return {
    exchange: "okx" as Exchange,
    label: "",
    apiKey: "",
    apiSecret: "",
    passphrase: "",
    productType: "spot" as ProductType,
    marginMode: "cross" as MarginMode,
  };
}

export function PersonalSettings() {
  const { language } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const copy = useMemo(() => language === "zh-CN" ? {
    title: "个人设置",
    subtitle: "管理你的登录密码和个人交易所 API key 绑定。",
    account: "账户",
    username: "用户名",
    displayName: "显示名称",
    password: "修改密码",
    currentPassword: "当前密码",
    newPassword: "新密码",
    confirmPassword: "确认新密码",
    savePassword: "保存密码",
    passwordSaved: "密码已更新",
    passwordMismatch: "两次输入的新密码不一致",
    apiTitle: "交易所 API 绑定",
    apiDesc: "支持为 OKX 和 Binance 绑定多组 API key。列表只显示脱敏信息，不回传 API secret。",
    addBinding: "添加绑定",
    label: "标签",
    exchange: "交易所",
    productType: "产品类型",
    marginMode: "保证金模式",
    apiKey: "API Key",
    apiSecret: "API Secret",
    passphrase: "Passphrase",
    saveBinding: "保存绑定",
    bindingSaved: "绑定已保存",
    bindingDeleted: "绑定已删除",
    missingFields: "请填写必填字段",
    empty: "还没有绑定 API key",
    createdAt: "创建时间",
    updatedAt: "更新时间",
    secretConfigured: "Secret 已保存",
    passphraseConfigured: "Passphrase 已保存",
    delete: "删除",
    loading: "正在加载个人设置...",
  } : {
    title: "Personal Settings",
    subtitle: "Manage your login password and personal exchange API key bindings.",
    account: "Account",
    username: "Username",
    displayName: "Display name",
    password: "Change password",
    currentPassword: "Current password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    savePassword: "Save password",
    passwordSaved: "Password updated",
    passwordMismatch: "New passwords do not match",
    apiTitle: "Exchange API Bindings",
    apiDesc: "Bind multiple OKX and Binance API keys. The list only shows redacted metadata and never returns API secrets.",
    addBinding: "Add binding",
    label: "Label",
    exchange: "Exchange",
    productType: "Product",
    marginMode: "Margin mode",
    apiKey: "API Key",
    apiSecret: "API Secret",
    passphrase: "Passphrase",
    saveBinding: "Save binding",
    bindingSaved: "Binding saved",
    bindingDeleted: "Binding deleted",
    missingFields: "Fill required fields",
    empty: "No API key bindings yet",
    createdAt: "Created",
    updatedAt: "Updated",
    secretConfigured: "Secret saved",
    passphraseConfigured: "Passphrase saved",
    delete: "Delete",
    loading: "Loading personal settings...",
  }, [language]);

  const [bindings, setBindings] = useState<ExchangeApiKeyBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [keyForm, setKeyForm] = useState(() => emptyKeyForm());
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingBinding, setSavingBinding] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadBindings = async () => {
    const result = await api.listExchangeApiKeys();
    setBindings(result.bindings);
  };

  useEffect(() => {
    let alive = true;
    api.listExchangeApiKeys()
      .then((result) => {
        if (alive) setBindings(result.bindings);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load API keys"))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (passwordForm.next !== passwordForm.confirm) {
      toast.error(copy.passwordMismatch);
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(passwordForm.current, passwordForm.next);
      setPasswordForm({ current: "", next: "", confirm: "" });
      toast.success(copy.passwordSaved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update password");
    } finally {
      setSavingPassword(false);
    }
  };

  const submitBinding = async (event: FormEvent) => {
    event.preventDefault();
    if (!keyForm.apiKey.trim() || !keyForm.apiSecret.trim() || (keyForm.exchange === "okx" && !keyForm.passphrase.trim())) {
      toast.error(copy.missingFields);
      return;
    }
    setSavingBinding(true);
    try {
      await api.createExchangeApiKey({
        exchange: keyForm.exchange,
        label: keyForm.label.trim() || undefined,
        api_key: keyForm.apiKey.trim(),
        api_secret: keyForm.apiSecret.trim(),
        passphrase: keyForm.passphrase.trim() || undefined,
        product_type: keyForm.productType,
        margin_mode: keyForm.marginMode,
      });
      setKeyForm(emptyKeyForm());
      await loadBindings();
      toast.success(copy.bindingSaved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save API key");
    } finally {
      setSavingBinding(false);
    }
  };

  const deleteBinding = async (bindingId: number) => {
    setDeletingId(bindingId);
    try {
      await api.deleteExchangeApiKey(bindingId);
      setBindings((current) => current.filter((binding) => binding.binding_id !== bindingId));
      toast.success(copy.bindingDeleted);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete API key");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{copy.subtitle}</p>
      </div>

      <section className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <UserCog className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">{copy.account}</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border bg-muted/20 p-4 text-sm">
            <div className="text-xs font-medium uppercase text-muted-foreground">{copy.username}</div>
            <div className="mt-1 font-medium">{user?.username}</div>
          </div>
          <div className="rounded-md border bg-muted/20 p-4 text-sm">
            <div className="text-xs font-medium uppercase text-muted-foreground">{copy.displayName}</div>
            <div className="mt-1 font-medium">{user?.display_name}</div>
          </div>
        </div>
      </section>

      <form onSubmit={submitPassword} className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">{copy.password}</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-2">
            <span className={labelClass}>{copy.currentPassword}</span>
            <input
              type="password"
              value={passwordForm.current}
              onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })}
              className={fieldClass}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="grid gap-2">
            <span className={labelClass}>{copy.newPassword}</span>
            <input
              type="password"
              minLength={8}
              value={passwordForm.next}
              onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })}
              className={fieldClass}
              autoComplete="new-password"
              required
            />
          </label>
          <label className="grid gap-2">
            <span className={labelClass}>{copy.confirmPassword}</span>
            <input
              type="password"
              minLength={8}
              value={passwordForm.confirm}
              onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })}
              className={fieldClass}
              autoComplete="new-password"
              required
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={savingPassword}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {copy.savePassword}
        </button>
      </form>

      <section id="exchange-api-bindings" className="scroll-mt-6 rounded-lg border bg-card p-5 shadow-sm">
        <div className="mb-5 space-y-1">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{copy.apiTitle}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{copy.apiDesc}</p>
        </div>

        <form onSubmit={submitBinding} className="grid gap-4 rounded-md border bg-muted/15 p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2">
              <span className={labelClass}>{copy.exchange}</span>
              <select
                value={keyForm.exchange}
                onChange={(event) => setKeyForm({ ...keyForm, exchange: event.target.value as Exchange })}
                className={fieldClass}
              >
                <option value="okx">OKX</option>
                <option value="binance">Binance</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>{copy.label}</span>
              <input
                value={keyForm.label}
                onChange={(event) => setKeyForm({ ...keyForm, label: event.target.value })}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>{copy.productType}</span>
              <select
                value={keyForm.productType}
                onChange={(event) => setKeyForm({ ...keyForm, productType: event.target.value as ProductType })}
                className={fieldClass}
              >
                <option value="spot">spot</option>
                <option value="usdm_futures">usdm_futures</option>
              </select>
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className={labelClass}>{copy.apiKey}</span>
              <input
                value={keyForm.apiKey}
                onChange={(event) => setKeyForm({ ...keyForm, apiKey: event.target.value })}
                className={`${fieldClass} font-mono`}
                autoComplete="off"
                required
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>{copy.apiSecret}</span>
              <input
                type="password"
                value={keyForm.apiSecret}
                onChange={(event) => setKeyForm({ ...keyForm, apiSecret: event.target.value })}
                className={`${fieldClass} font-mono`}
                autoComplete="off"
                required
              />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <span className={labelClass}>{copy.passphrase}</span>
              <input
                type="password"
                value={keyForm.passphrase}
                onChange={(event) => setKeyForm({ ...keyForm, passphrase: event.target.value })}
                className={`${fieldClass} font-mono`}
                autoComplete="off"
                disabled={keyForm.exchange !== "okx"}
                required={keyForm.exchange === "okx"}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>{copy.marginMode}</span>
              <select
                value={keyForm.marginMode}
                onChange={(event) => setKeyForm({ ...keyForm, marginMode: event.target.value as MarginMode })}
                className={fieldClass}
              >
                <option value="cross">cross</option>
                <option value="isolated">isolated</option>
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={savingBinding}
            className="inline-flex w-fit items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {savingBinding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {copy.saveBinding}
          </button>
        </form>

        <div className="mt-5 overflow-hidden rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {copy.loading}
            </div>
          ) : bindings.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">{copy.empty}</div>
          ) : (
            <div className="divide-y">
              {bindings.map((binding) => (
                <div key={binding.binding_id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{binding.label}</span>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase text-muted-foreground">{binding.exchange}</span>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{binding.product_type}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-mono">{binding.api_key_hint}</span>
                      {binding.api_secret_configured && <span>{copy.secretConfigured}</span>}
                      {binding.passphrase_configured && <span>{copy.passphraseConfigured}</span>}
                      <span>{copy.createdAt}: {binding.created_at}</span>
                      <span>{copy.updatedAt}: {binding.updated_at}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteBinding(binding.binding_id)}
                    disabled={deletingId === binding.binding_id}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm text-muted-foreground transition hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingId === binding.binding_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {copy.delete}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
