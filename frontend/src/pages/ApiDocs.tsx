import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Code2, Copy, ExternalLink, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/I18nProvider";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "options" | "head";
type ApiOperation = {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: Array<{ name?: string; in?: string; required?: boolean; description?: string; schema?: unknown }>;
  requestBody?: unknown;
  responses?: Record<string, unknown>;
};
type ApiDocument = {
  info?: { title?: string; version?: string; description?: string };
  components?: { schemas?: Record<string, unknown> };
  paths?: Record<string, Partial<Record<HttpMethod, ApiOperation>>>;
};
type Endpoint = { method: HttpMethod; path: string; operation: ApiOperation };

const METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete", "options", "head"];

function methodClass(method: HttpMethod) {
  if (method === "get") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (method === "post") return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (method === "put" || method === "patch") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-red-500/10 text-red-700 dark:text-red-300";
}

function resolveSchemaRefs(value: unknown, schemas: Record<string, unknown>, depth = 0, seen = new Set<string>()): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => resolveSchemaRefs(item, schemas, depth + 1, seen));
  const object = value as Record<string, unknown>;
  const reference = object.$ref;
  if (typeof reference === "string" && reference.startsWith("#/components/schemas/")) {
    const name = reference.slice("#/components/schemas/".length).replace(/~1/g, "/").replace(/~0/g, "~");
    const target = schemas[name];
    if (target && !seen.has(reference)) {
      const nextSeen = new Set(seen);
      nextSeen.add(reference);
      return {
        ...(resolveSchemaRefs(target, schemas, depth + 1, nextSeen) as Record<string, unknown>),
        ...Object.fromEntries(Object.entries(object).filter(([key]) => key !== "$ref").map(([key, item]) => [key, resolveSchemaRefs(item, schemas, depth + 1, nextSeen)])),
      };
    }
    return object;
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, resolveSchemaRefs(item, schemas, depth + 1, seen)]));
}

export function ApiDocs() {
  const { language } = useTranslation();
  const zh = language === "zh-CN";
  const copy = zh ? {
    eyebrow: "开发者中心", title: "API 文档", subtitle: "接口目录自动读取当前服务的 OpenAPI 定义。选择接口查看参数和响应结构。",
    search: "搜索路径、说明或标签", all: "全部标签", loading: "正在读取 API schema…", retry: "重试",
    count: "个接口", noMatches: "没有匹配的接口。", select: "从左侧选择一个接口查看详情。",
    parameters: "参数", request: "请求体 schema", responses: "响应 schema", copyPath: "复制路径", copied: "路径已复制",
    swagger: "在 Swagger UI 中打开", schemaFail: "无法读取 OpenAPI schema。请确认后端 /openapi.json 可以通过当前域名访问。",
    operationId: "操作 ID", optional: "可选", required: "必填",
  } : {
    eyebrow: "Developer center", title: "API documentation", subtitle: "This catalog reads the live OpenAPI definition. Select an operation to inspect its parameters and response schemas.",
    search: "Search paths, descriptions, or tags", all: "All tags", loading: "Loading API schema…", retry: "Retry",
    count: "operations", noMatches: "No operations match your search.", select: "Select an operation to inspect it.",
    parameters: "Parameters", request: "Request body schema", responses: "Response schemas", copyPath: "Copy path", copied: "Path copied",
    swagger: "Open Swagger UI", schemaFail: "Could not load the OpenAPI schema. Make sure /openapi.json is reachable through this domain.",
    operationId: "Operation ID", optional: "Optional", required: "Required",
  };

  const [document, setDocument] = useState<ApiDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [selectedKey, setSelectedKey] = useState("");

  const loadSchema = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.getOpenApiSpec();
      const next = result as unknown as ApiDocument;
      setDocument(next);
      const first = Object.entries(next.paths ?? {}).flatMap(([path, methods]) =>
        METHODS.filter((method) => methods[method]).map((method) => `${method.toUpperCase()} ${path}`),
      )[0] ?? "";
      setSelectedKey((current) => current || first);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.schemaFail);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadSchema(); }, []);

  const endpoints = useMemo<Endpoint[]>(() => {
    const result: Endpoint[] = [];
    for (const [path, pathItem] of Object.entries(document?.paths ?? {})) {
      for (const method of METHODS) {
        const operation = pathItem[method];
        if (operation) result.push({ method, path, operation });
      }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path) || METHODS.indexOf(a.method) - METHODS.indexOf(b.method));
  }, [document]);
  const tags = useMemo(() => Array.from(new Set(endpoints.flatMap((item) => item.operation.tags ?? []))).sort(), [endpoints]);
  const filteredEndpoints = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return endpoints.filter(({ method, path, operation }) => {
      const matchesTag = !tag || operation.tags?.includes(tag);
      const haystack = [method, path, operation.summary, operation.description, ...(operation.tags ?? [])]
        .filter(Boolean).join(" ").toLocaleLowerCase();
      return matchesTag && (!needle || haystack.includes(needle));
    });
  }, [endpoints, query, tag]);
  const selected = endpoints.find((item) => `${item.method.toUpperCase()} ${item.path}` === selectedKey) ?? null;
  const schemas = document?.components?.schemas ?? {};

  const copyPath = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.path);
      toast.success(copy.copied);
    } catch {
      toast.error(zh ? "无法访问剪贴板" : "Clipboard access is unavailable");
    }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Code2 className="h-4 w-4" />{copy.eyebrow}</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{document?.info?.title ? `${document.info.title} · ${document.info.version ?? ""} — ` : ""}{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <a href="/docs" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
            {copy.swagger}<ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">{copy.loading}</div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-8 text-center">
          <p className="text-sm text-red-700 dark:text-red-300">{error || copy.schemaFail}</p>
          <button type="button" onClick={() => void loadSchema()} className="mt-4 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
            <RefreshCw className="h-4 w-4" />{copy.retry}
          </button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
          <aside className="flex max-h-[72vh] min-h-[460px] flex-col overflow-hidden rounded-xl border bg-card">
            <div className="space-y-2 border-b p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search}
                  className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
              </label>
              <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label={copy.all}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                <option value="">{copy.all}</option>
                {tags.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <div className="text-xs text-muted-foreground">{filteredEndpoints.length} {copy.count}</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filteredEndpoints.length ? filteredEndpoints.map((item) => {
                const key = `${item.method.toUpperCase()} ${item.path}`;
                return (
                  <button key={key} type="button" onClick={() => setSelectedKey(key)}
                    className={cn("mb-1 w-full rounded-md border border-transparent p-2.5 text-left transition", selectedKey === key ? "border-primary/30 bg-primary/5" : "hover:bg-muted")}>
                    <div className="flex items-start gap-2">
                      <span className={cn("mt-0.5 min-w-14 rounded px-1.5 py-1 text-center text-[10px] font-bold uppercase", methodClass(item.method))}>{item.method}</span>
                      <span className="break-all font-mono text-xs leading-5">{item.path}</span>
                    </div>
                    <div className="mt-1.5 line-clamp-2 pl-[4.5rem] text-xs text-muted-foreground">{item.operation.summary || item.operation.operationId || (zh ? "未提供说明" : "No description")}</div>
                  </button>
                );
              }) : <div className="p-6 text-center text-sm text-muted-foreground">{copy.noMatches}</div>}
            </div>
          </aside>

          <section className="min-h-[460px] rounded-xl border bg-card p-5 sm:p-6">
            {!selected ? <div className="flex h-full min-h-[400px] items-center justify-center text-sm text-muted-foreground">{copy.select}</div> : <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded px-2 py-1 text-xs font-bold uppercase", methodClass(selected.method))}>{selected.method}</span>
                    {(selected.operation.tags ?? []).map((item) => <span key={item} className="rounded-full border px-2 py-1 text-[11px] text-muted-foreground">{item}</span>)}
                  </div>
                  <h2 className="mt-3 break-all font-mono text-lg font-semibold">{selected.path}</h2>
                  <p className="mt-2 text-sm font-medium">{selected.operation.summary || selected.operation.operationId}</p>
                  {selected.operation.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{selected.operation.description}</p>}
                  {selected.operation.operationId && <p className="mt-2 text-xs text-muted-foreground">{copy.operationId}: <code>{selected.operation.operationId}</code></p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => void copyPath()} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"><Copy className="h-4 w-4" />{copy.copyPath}</button>
                  <a href="/docs" target="_blank" rel="noreferrer" title={copy.swagger} className="inline-flex items-center justify-center rounded-md border px-3 py-2 hover:bg-muted"><ArrowUpRight className="h-4 w-4" /></a>
                </div>
              </div>

              <div className="grid gap-6 pt-5 xl:grid-cols-2">
                <div>
                  <h3 className="mb-3 text-sm font-semibold">{copy.parameters}</h3>
                  {selected.operation.parameters?.length ? <div className="space-y-2">
                    {selected.operation.parameters.map((parameter, index) => (
                      <div key={`${parameter.in}-${parameter.name}-${index}`} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2"><code className="text-sm font-semibold">{parameter.name}</code><span className="text-xs text-muted-foreground">{parameter.in}</span><span className="text-[10px] text-muted-foreground">{parameter.required ? copy.required : copy.optional}</span></div>
                        {parameter.description && <p className="mt-1 text-xs text-muted-foreground">{parameter.description}</p>}
                        {parameter.schema && <pre className="mt-2 overflow-x-auto rounded bg-muted/60 p-2 text-xs">{JSON.stringify(resolveSchemaRefs(parameter.schema, schemas), null, 2)}</pre>}
                      </div>
                    ))}
                  </div> : <p className="text-sm text-muted-foreground">—</p>}
                  {selected.operation.requestBody && <>
                    <h3 className="mb-2 mt-5 text-sm font-semibold">{copy.request}</h3>
                    <pre className="max-h-64 overflow-auto rounded-lg bg-muted/60 p-3 text-xs leading-5">{JSON.stringify(resolveSchemaRefs(selected.operation.requestBody, schemas), null, 2)}</pre>
                  </>}
                </div>
                <div>
                  <h3 className="mb-3 text-sm font-semibold">{copy.responses}</h3>
                  <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted/60 p-3 text-xs leading-5">{JSON.stringify(resolveSchemaRefs(selected.operation.responses ?? {}, schemas), null, 2)}</pre>
                </div>
              </div>
            </>}
          </section>
        </div>
      )}
    </main>
  );
}
