import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getApiAuthKey, setApiAuthKey } from "@/lib/apiAuth";

const inputClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export function OperatorLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (getApiAuthKey()) {
    return <Navigate to={(location.state as { from?: string } | null)?.from || "/operator"} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      toast.error("请输入平台管理 API Key");
      return;
    }
    setSubmitting(true);
    try {
      setApiAuthKey(trimmed);
      await api.getAdminDashboard();
      navigate((location.state as { from?: string } | null)?.from || "/operator", { replace: true });
    } catch (error) {
      setApiAuthKey("");
      toast.error(error instanceof Error ? error.message : "平台管理登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen bg-background">
      <section className="hidden min-h-screen w-[42%] border-r bg-card px-10 py-12 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          Venus
        </div>
        <div className="mt-auto max-w-md space-y-4 pb-16">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <ShieldCheck className="h-4 w-4" />
            平台管理后台
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-normal">
            面向平台运营和管理人员的独立入口。
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            用户工作台只承载个人研究、策略和会话。平台用户、策略商城发布、Agent 调用统计在这里统一管理。
          </p>
        </div>
      </section>

      <section className="flex flex-1 items-center justify-center px-5 py-10">
        <form onSubmit={submit} className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span className="font-semibold">Venus</span>
          </div>

          <div className="mb-5 space-y-1">
            <h2 className="text-xl font-semibold tracking-normal">平台管理登录</h2>
            <p className="text-sm text-muted-foreground">使用服务端配置的 API Key 进入管理后台。</p>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-medium">管理 API Key</span>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                className={`${inputClass} pr-10`}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowKey((value) => !value)}
                className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:text-foreground"
                title={showKey ? "隐藏 API Key" : "显示 API Key"}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            登录管理后台
          </button>
        </form>
      </section>
    </main>
  );
}
