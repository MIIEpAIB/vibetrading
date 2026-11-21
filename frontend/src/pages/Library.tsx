import { useMemo, useState } from "react";
import { ArrowUpRight, BookOpen, FileText, Search, Sparkles } from "lucide-react";
import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { useTranslation } from "@/i18n/I18nProvider";

type LibraryCategory = "all" | "docs" | "tutorials" | "alpha";

const ARTICLES = [
  {
    id: "getting-started",
    category: "docs" as const,
    href: "https://vibetrading.wiki/docs/",
    icon: FileText,
    title: { "zh-CN": "从主观交易到量化研究", "en-US": "From discretionary trading to quant research" },
    description: {
      "zh-CN": "将交易规则转化为信号、参数、回测和影子盘监控项。",
      "en-US": "Turn trading rules into signals, parameters, backtests, and shadow-monitoring checks.",
    },
    label: { "zh-CN": "项目文档", "en-US": "Documentation" },
  },
  {
    id: "market-basics",
    category: "tutorials" as const,
    href: "https://vibetrading.wiki/tutorials/",
    icon: BookOpen,
    title: { "zh-CN": "量化研究者的市场常识", "en-US": "Market basics for quant researchers" },
    description: {
      "zh-CN": "了解交易成本、滑点、流动性、交易所规则和仓位管理。",
      "en-US": "Learn about trading costs, slippage, liquidity, exchange rules, and position management.",
    },
    label: { "zh-CN": "教程", "en-US": "Tutorials" },
  },
  {
    id: "alpha-library",
    category: "alpha" as const,
    href: "https://vibetrading.wiki/alpha-library/",
    icon: Sparkles,
    title: { "zh-CN": "Alpha 因子与策略研究", "en-US": "Alpha factors and strategy research" },
    description: {
      "zh-CN": "查看因子研究资料，了解验证与风险检查流程。",
      "en-US": "Explore factor research and learn how to validate ideas and review risk.",
    },
    label: { "zh-CN": "Alpha 研究", "en-US": "Alpha research" },
  },
];

export function LibraryPage() {
  const { language } = useTranslation();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<LibraryCategory>("all");
  const zh = language === "zh-CN";
  const copy = zh ? {
    eyebrow: "知识中心",
    title: "文库",
    subtitle: "搜索项目文档、实战教程和 Alpha 研究资料。打开条目将在新标签页中访问文档站。",
    search: "搜索标题、主题或分类",
    all: "全部",
    docs: "项目文档",
    tutorials: "教程",
    alpha: "Alpha 研究",
    results: "条目",
    open: "阅读资料",
    empty: "没有找到匹配的资料。试试其他关键词或分类。",
  } : {
    eyebrow: "Knowledge hub",
    title: "Library",
    subtitle: "Search project documentation, practical tutorials, and Alpha research. Resources open on the documentation site in a new tab.",
    search: "Search titles, topics, or categories",
    all: "All resources",
    docs: "Documentation",
    tutorials: "Tutorials",
    alpha: "Alpha research",
    results: "resources",
    open: "Read resource",
    empty: "No resources match your search. Try another keyword or category.",
  };
  const categories: { id: LibraryCategory; label: string }[] = [
    { id: "all", label: copy.all },
    { id: "docs", label: copy.docs },
    { id: "tutorials", label: copy.tutorials },
    { id: "alpha", label: copy.alpha },
  ];
  const filteredArticles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return ARTICLES.filter((article) => {
      if (category !== "all" && article.category !== category) return false;
      if (!needle) return true;
      return [article.title[language], article.description[language], article.label[language]]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [category, language, query]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-primary">{copy.eyebrow}</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
        </div>
        <LanguageToggle />
      </div>

      <div className="mb-5 flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search}
            className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
        </label>
        <div className="flex gap-1 overflow-x-auto" role="group" aria-label={copy.title}>
          {categories.map((item) => (
            <button key={item.id} type="button" onClick={() => setCategory(item.id)} aria-pressed={category === item.id}
              className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium transition ${category === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 text-xs text-muted-foreground">{filteredArticles.length} {copy.results}</div>
      {filteredArticles.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredArticles.map((article) => {
            const Icon = article.icon;
            return (
              <article key={article.id} className="flex min-h-52 flex-col rounded-xl border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
                  <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">{article.label[language]}</span>
                </div>
                <h2 className="mt-4 text-lg font-semibold">{article.title[language]}</h2>
                <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{article.description[language]}</p>
                <a href={article.href} target="_blank" rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                  {copy.open}<ArrowUpRight className="h-4 w-4" />
                </a>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="rounded-xl border border-dashed bg-card px-5 py-14 text-center text-sm text-muted-foreground">{copy.empty}</div>
      )}
    </main>
  );
}
