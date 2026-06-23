import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth";

const fieldClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

export function Auth() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to={(location.state as { from?: string } | null)?.from || "/dashboard"} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(username, password);
      } else {
        await register(username, password, displayName || undefined);
      }
      navigate((location.state as { from?: string } | null)?.from || "/dashboard", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const isRegister = mode === "register";

  return (
    <main className="flex min-h-screen bg-background">
      <section className="hidden min-h-screen w-[42%] border-r bg-card px-10 py-12 lg:flex lg:flex-col">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <img src="/favicon.svg" alt="" className="h-6 w-6" />
          Venus
        </div>
        <div className="mt-auto max-w-md space-y-4 pb-16">
          <div className="text-sm font-medium text-primary">Private workspace</div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Research, sessions, and agent records stay attached to your account.
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Sign in to enter your dedicated trading research backend.
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
            <h2 className="text-xl font-semibold tracking-tight">
              {isRegister ? "Create account" : "Sign in"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isRegister ? "Create a private workspace." : "Access your personal dashboard."}
            </p>
          </div>

          <div className="space-y-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className={fieldClass}
                autoComplete="username"
                required
                minLength={3}
                maxLength={64}
              />
            </label>

            {isRegister ? (
              <label className="grid gap-2">
                <span className="text-sm font-medium">Display name</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className={fieldClass}
                  autoComplete="name"
                  maxLength={191}
                />
              </label>
            ) : null}

            <label className="grid gap-2">
              <span className="text-sm font-medium">Password</span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`${fieldClass} pr-10`}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  required
                  minLength={isRegister ? 8 : 1}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:text-foreground"
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isRegister ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {isRegister ? "Create account" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => setMode(isRegister ? "login" : "register")}
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            {isRegister ? "Already have an account? Sign in" : "Need an account? Register"}
          </button>
        </form>
      </section>
    </main>
  );
}
