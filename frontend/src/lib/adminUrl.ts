const DEFAULT_ADMIN_URL = "http://127.0.0.1:8787";

export function adminUrl(hash?: string): string {
  const base = (import.meta.env.VITE_ADMIN_URL || DEFAULT_ADMIN_URL).replace(/\/+$/, "");
  return hash ? `${base}#${hash.replace(/^#/, "")}` : base;
}
