import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  Gauge,
  Library,
  Play,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  Users,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api, type StrategyLibraryItem, type StrategyMarketAdminItem } from "@/lib/api";
import { useTranslation } from "@/i18n/I18nProvider";
import {
  createMarketOwnedStrategy,
  defaultShadowRiskPolicyForMarketStrategy,
  getMarketOwnershipTag,
  getStrategyRouteId,
  type MarketBacktestSummary,
  type MarketOwnership,
  type StrategyCatalogItem,
} from "@/lib/strategyMarketplace";
import { upsertOwnedStrategy } from "@/lib/strategyStorage";

type MarketSection = {
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  icon: LucideIcon;
  kind: "built-in" | "paid" | "community";
  items: StrategyCatalogItem[];
};

type BacktestSelection = {
  item: StrategyCatalogItem;
  summary: MarketBacktestSummary;
};

function catalogItemToStrategy(item: StrategyMarketAdminItem): StrategyCatalogItem {
  return {
    id: item.id,
    name: item.name || item.id,
    summary: item.summary || item.description || item.note || item.name || item.id,
    description: item.description,
    strategyDescription: item.strategy_description,
    usage: [],
    riskNotes: item.risk_warnings,
    language: item.language,
    codeSnapshot: item.code_snapshot,
    tags: item.tags ?? [],
    category: normalizeCategory(item.category ?? ""),
    kind: item.kind === "paid" ? "paid" : item.kind === "community" ? "community" : "built-in",
    price: item.price || undefined,
  };
}

const MARKET_COPY = {
  "en-US": {
    kicker: "Strategy Market",
    title: "Browse platform strategies and save a copy into your own library.",
    subtitle:
      "Built-in strategies are free to inspect and favorite. Paid strategies can be purchased locally, then appear in your owned library for editing, export, and QUANTAXIS shadow deployment.",
    openLibrary: "Open my library",
    sectionHint: "Saved items move into your private strategy library.",
    saved: "Saved",
    favorited: "Favorited",
    purchased: "Purchased",
    backtest: "Backtest",
    backtestPassed: "Backtest passed",
    backtestFailed: "Backtest failed",
    preview: "Preview",
    favorite: "Favorite",
    purchase: "Purchase",
    owned: "Owned",
    builtIn: {
      title: "Built-in strategies",
      description: "Free platform strategies with direct backtest and favorite actions.",
    },
    paid: {
      title: "Paid strategies",
      description: "Subscription-style strategies that can be purchased into your library.",
    },
    community: {
      title: "Community strategies",
      description: "User-published strategy snapshots you can save into your own library.",
    },
  },
  "zh-CN": {
    kicker: "策略商城",
    title: "浏览平台策略，并把选中的策略保存到自己的策略库。",
    subtitle:
      "内置策略可直接查看和收藏；付费策略可以本地购买后进入你的私有策略库，继续编辑、导出和模拟盘部署。",
    openLibrary: "打开我的策略库",
    sectionHint: "已保存的条目会进入你的私有策略库。",
    saved: "已保存",
    favorited: "已收藏",
    purchased: "已购买",
    backtest: "回测",
    backtestPassed: "回测通过",
    backtestFailed: "回测未通过",
    preview: "预览",
    favorite: "收藏",
    purchase: "购买",
    owned: "已拥有",
    builtIn: {
      title: "内置策略",
      description: "平台免费策略，可直接回测并收藏到自己的策略库。",
    },
    paid: {
      title: "付费策略",
      description: "订阅型策略，可购买后进入你的策略库继续使用。",
    },
    community: {
      title: "社区策略",
      description: "用户发布的策略快照，可保存到自己的策略库继续编辑和回测。",
    },
  },
} as const;

const strategyCategories = ["trend", "mean_reversion", "grid", "risk", "portfolio", "arbitrage", "utility"] as const;

function normalizeCategory(value: string): StrategyCatalogItem["category"] {
  return strategyCategories.includes(value as StrategyCatalogItem["category"])
    ? value as StrategyCatalogItem["category"]
    : "utility";
}

function formatOwnershipLabel(language: "en-US" | "zh-CN", ownership: MarketOwnership | null) {
  if (!ownership) return null;
  return language === "zh-CN"
    ? ownership === "favorite"
      ? MARKET_COPY["zh-CN"].favorited
      : MARKET_COPY["zh-CN"].purchased
    : ownership === "favorite"
      ? MARKET_COPY["en-US"].favorited
      : MARKET_COPY["en-US"].purchased;
}

function MarketCard({
  item,
  actionLabel,
  secondaryLabel,
  ownedLabel,
  secondaryBusy = false,
  onAction,
  onSecondaryAction,
  kind,
  language,
}: {
  item: StrategyCatalogItem;
  actionLabel: string;
  secondaryLabel: string;
  ownedLabel: string | null;
  secondaryBusy?: boolean;
  onAction: () => void;
  onSecondaryAction: () => void;
  kind: "built-in" | "paid" | "community";
  language: "en-US" | "zh-CN";
}) {
  const ownTag = ownedLabel ? <span className="rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-primary">{ownedLabel}</span> : null;
  const price = item.price ? (
    <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{item.price}</span>
  ) : (
    <span className="rounded-md border bg-background px-2 py-1 text-xs font-semibold text-muted-foreground">{language === "zh-CN" ? "免费" : "Free"}</span>
  );

  return (
    <article className="rounded-md border bg-card px-4 py-3">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_12rem_15rem] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-base font-semibold leading-6 text-foreground">
              <Link to={`/strategy/${encodeURIComponent(getStrategyRouteId(item.id))}`} className="transition hover:text-primary">
                {item.name}
              </Link>
            </h3>
            {price}
            {ownTag}
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{item.summary}</p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <span key={tag} className="rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>

          {item.id === "professional-grid-trading" && (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {language === "zh-CN"
                ? "内置区间网格、仓位层级、波动暂停、止损清仓和模拟盘信号。"
                : "Includes range grid, tiered sizing, volatility pause, stop-loss flattening, and paper signal output."}
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-1 text-xs leading-5 text-muted-foreground">
          {item.description && <p className="line-clamp-2">{item.description}</p>}
          {item.usage?.length ? (
            <p className="line-clamp-2">
              <span className="font-semibold text-foreground">{language === "zh-CN" ? "使用方式" : "Usage"}: </span>
              {item.usage.join(" · ")}
            </p>
          ) : null}
          {item.riskNotes?.length ? (
            <p className="line-clamp-2">
              <span className="font-semibold text-foreground">{language === "zh-CN" ? "风控要点" : "Risk"}: </span>
              {item.riskNotes.join(" · ")}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 lg:justify-self-end">
        <button
          type="button"
          onClick={onSecondaryAction}
          disabled={secondaryBusy}
          className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-60"
        >
          {kind === "built-in" ? <Gauge className="h-4 w-4 shrink-0 text-primary" /> : kind === "community" ? <Users className="h-4 w-4 shrink-0 text-primary" /> : <Sparkles className="h-4 w-4 shrink-0 text-primary" />}
          <span className="truncate">{secondaryBusy ? (language === "zh-CN" ? "回测中" : "Running") : secondaryLabel}</span>
        </button>
        <button
          type="button"
          onClick={onAction}
          className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
        >
          {kind === "built-in" ? <Star className="h-4 w-4 shrink-0" /> : kind === "community" ? <Library className="h-4 w-4 shrink-0" /> : <ShoppingBag className="h-4 w-4 shrink-0" />}
          <span className="truncate">{actionLabel}</span>
        </button>
        </div>
      </div>
    </article>
  );
}

function MarketSectionBlock({
  section,
  language,
  ownedStrategies,
  onFavorite,
  onPurchase,
  onPreview,
  onBacktest,
  backtestingId,
  onOpenLibrary,
}: {
  section: MarketSection;
  language: "en-US" | "zh-CN";
  ownedStrategies: StrategyLibraryItem[];
  onFavorite: (item: StrategyCatalogItem) => void;
  onPurchase: (item: StrategyCatalogItem) => void;
  onPreview: (item: StrategyCatalogItem) => void;
  onBacktest: (item: StrategyCatalogItem) => void;
  backtestingId: string | null;
  onOpenLibrary: () => void;
}) {
  const headerTitle = language === "zh-CN" ? section.titleZh : section.titleEn;
  const headerDescription = language === "zh-CN" ? section.descriptionZh : section.descriptionEn;

  return (
    <section className="border-b bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-1">
          <div className="inline-flex w-fit items-center gap-2 rounded-md border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            <section.icon className="h-3.5 w-3.5 text-primary" />
            {headerTitle}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{headerDescription}</p>
        </div>
        <div className="mt-4 space-y-2">
          {section.items.map((item) => {
            const ownedRecord = ownedStrategies.find((strategy) => strategy.id === item.id || strategy.id === `owned_${item.id}`);
            const ownedTag = ownedRecord ? getMarketOwnershipTag(ownedRecord.tags ?? []) : null;
            const ownedLabel = formatOwnershipLabel(language, ownedTag) ?? (language === "zh-CN" ? "已拥有" : "Owned");
            const isOwned = Boolean(ownedRecord);
            return (
              <MarketCard
                key={item.id}
                item={item}
                kind={section.kind}
                ownedLabel={ownedLabel}
                actionLabel={
                  isOwned
                    ? (language === "zh-CN" ? "去策略库" : "Open library")
                    : section.kind === "built-in"
                      ? (language === "zh-CN" ? MARKET_COPY["zh-CN"].favorite : MARKET_COPY["en-US"].favorite)
                      : section.kind === "community"
                        ? (language === "zh-CN" ? "保存" : "Save")
                      : (language === "zh-CN" ? MARKET_COPY["zh-CN"].purchase : MARKET_COPY["en-US"].purchase)
                }
                secondaryLabel={
                  section.kind === "built-in"
                    ? (language === "zh-CN" ? MARKET_COPY["zh-CN"].backtest : MARKET_COPY["en-US"].backtest)
                    : (language === "zh-CN" ? MARKET_COPY["zh-CN"].preview : MARKET_COPY["en-US"].preview)
                }
                secondaryBusy={backtestingId === item.id}
                onSecondaryAction={() => {
                  if (section.kind === "built-in") {
                    onBacktest(item);
                  } else {
                    onPreview(item);
                  }
                }}
                onAction={() => {
                  if (isOwned) {
                    onOpenLibrary();
                    return;
                  }
                  if (section.kind === "built-in") {
                    onFavorite(item);
                    return;
                  }
                  if (section.kind === "community") {
                    onFavorite(item);
                    return;
                  }
                  onPurchase(item);
                }}
                language={language}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function useOwnedMarketStrategies() {
  const [ownedStrategies, setOwnedStrategies] = useState<StrategyLibraryItem[]>([]);
  return { ownedStrategies, setOwnedStrategies };
}

export function StrategyMarket() {
  const { language } = useTranslation();
  const navigate = useNavigate();
  const copy = MARKET_COPY[language];
  const { ownedStrategies, setOwnedStrategies } = useOwnedMarketStrategies();
  const [backtestSelection, setBacktestSelection] = useState<BacktestSelection | null>(null);
  const [backtestingId, setBacktestingId] = useState<string | null>(null);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [marketCatalog, setMarketCatalog] = useState<StrategyCatalogItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.listStrategies()
      .then((payload) => {
        if (cancelled) return;
        const remote = payload.strategies.filter((item): item is StrategyLibraryItem => Boolean(item && item.id && item.name && item.code));
        setOwnedStrategies(remote);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setOwnedStrategies]);

  useEffect(() => {
    let cancelled = false;
    api.getStrategyMarketCatalogConfig()
      .then((payload) => {
        if (!cancelled) {
          setMarketCatalog(
            (payload.items ?? [])
              .filter((item) => item.enabled && item.status === "published" && !item.deleted)
              .map(catalogItemToStrategy),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const sections = useMemo<MarketSection[]>(
    () => [
      {
        titleZh: copy.builtIn.title,
        titleEn: copy.builtIn.title,
        descriptionZh: copy.builtIn.description,
        descriptionEn: copy.builtIn.description,
        icon: Library,
        kind: "built-in",
        items: marketCatalog.filter((item) => item.kind === "built-in"),
      },
      {
        titleZh: copy.paid.title,
        titleEn: copy.paid.title,
        descriptionZh: copy.paid.description,
        descriptionEn: copy.paid.description,
        icon: ShoppingBag,
        kind: "paid",
        items: marketCatalog.filter((item) => item.kind === "paid"),
      },
      {
        titleZh: copy.community.title,
        titleEn: copy.community.title,
        descriptionZh: copy.community.description,
        descriptionEn: copy.community.description,
        icon: Users,
        kind: "community",
        items: marketCatalog.filter((item) => item.kind === "community"),
      },
    ],
    [copy, marketCatalog],
  );

  const saveStrategy = async (item: StrategyCatalogItem, ownership: MarketOwnership) => {
    const nextStrategy = createMarketOwnedStrategy(item, ownership);
    await api.upsertStrategy(nextStrategy);
    setOwnedStrategies((current) => upsertOwnedStrategy(current, nextStrategy));
    toast.success(language === "zh-CN" ? `${item.name} ${copy.saved}` : `${item.name} ${copy.saved}`);
    return nextStrategy;
  };

  const handleFavorite = (item: StrategyCatalogItem) => {
    void saveStrategy(item, "favorite").catch((error) => {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "保存策略失败" : "Failed to save strategy");
    });
  };
  const handlePurchase = (item: StrategyCatalogItem) => {
    void saveStrategy(item, "purchased").catch((error) => {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "购买策略失败" : "Failed to purchase strategy");
    });
  };
  const handlePreview = (item: StrategyCatalogItem) => {
    navigate(`/strategy/${encodeURIComponent(getStrategyRouteId(item.id))}`);
  };
  const handleBacktest = async (item: StrategyCatalogItem) => {
    setBacktestingId(item.id);
    let summary: MarketBacktestSummary;
    try {
      const result = await api.runStrategyMarketBacktest({ strategy_id: item.id });
      summary = {
        symbol: result.symbol,
        timeframe: result.timeframe,
        period: result.period,
        totalReturnPct: result.totalReturnPct,
        annualizedReturnPct: result.annualizedReturnPct,
        maxDrawdownPct: result.maxDrawdownPct,
        sharpe: result.sharpe,
        winRatePct: result.winRatePct,
        tradeCount: result.tradeCount,
        status: result.status,
        engine: result.engine,
        assumptions: result.assumptions,
        warnings: result.warnings,
        run_id: result.run_id,
        run_directory: result.run_directory,
      };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "真实回测失败" : "Real backtest failed");
      setBacktestingId(null);
      return;
    }
    const ownedRecord = ownedStrategies.find((strategy) => strategy.id === item.id);
    if (!ownedRecord) {
      void saveStrategy(item, "favorite");
    }
    setBacktestSelection({ item, summary });
    const message = summary.status === "passed"
      ? (language === "zh-CN" ? `回测通过：${item.name}` : `Backtest passed: ${item.name}`)
      : (language === "zh-CN" ? `回测未通过：${item.name}` : `Backtest failed: ${item.name}`);
    toast[summary.status === "passed" ? "success" : "error"](message);
    setBacktestingId(null);
  };
  const handleDeployPaper = async () => {
    if (!backtestSelection) return;
    if (backtestSelection.summary.status !== "passed") {
      toast.error(language === "zh-CN" ? "回测未通过，不能转入模拟盘" : "Backtest did not pass; shadow deployment is blocked");
      return;
    }
    setDeployingId(backtestSelection.item.id);
    try {
      const strategy = createMarketOwnedStrategy(backtestSelection.item, "favorite");
      await api.upsertStrategy(strategy);
      setOwnedStrategies((current) => upsertOwnedStrategy(current, strategy));
      const limits = defaultShadowRiskPolicyForMarketStrategy(backtestSelection.item);
      const result = await api.createDeployment({
        strategy_id: strategy.id,
        target: "SHADOW",
        market: "CRYPTO",
        symbols: limits.symbols,
        timeframe: "1h",
        parameters: {},
        risk_policy: limits,
      });
      await api.readyDeployment(result.deployment.deployment_id).catch(() => undefined);
      toast.success(language === "zh-CN" ? "已创建模拟盘部署" : "Shadow deployment created");
      navigate(`/deployments/${encodeURIComponent(result.deployment.deployment_id)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "启动模拟盘失败" : "Failed to start paper trading");
    } finally {
      setDeployingId(null);
    }
  };
  const handleOpenLibrary = () => {
    navigate("/strategies");
  };

  return (
    <main className="min-h-full bg-background">
      <section className="border-b bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:px-8">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {copy.kicker}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-normal sm:text-4xl">{copy.title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.subtitle}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                to="/strategies"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                <Library className="h-4 w-4" />
                {copy.openLibrary}
              </Link>
              <Link
                to="/agent"
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Play className="h-4 w-4" />
                {language === "zh-CN" ? "打开智能体" : "Open assistant"}
              </Link>
            </div>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <div className="flex h-24 items-center justify-center rounded-md bg-gradient-to-br from-slate-900 to-teal-600 text-white">
              <ShoppingBag className="h-10 w-10" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-md border bg-card p-3">
                <div className="font-mono text-lg font-semibold">{marketCatalog.filter((item) => item.kind === "built-in").length}</div>
                <div className="mt-1 text-xs text-muted-foreground">{language === "zh-CN" ? "内置" : "Built-in"}</div>
              </div>
              <div className="rounded-md border bg-card p-3">
                <div className="font-mono text-lg font-semibold">{marketCatalog.filter((item) => item.kind === "paid").length}</div>
                <div className="mt-1 text-xs text-muted-foreground">{language === "zh-CN" ? "付费" : "Paid"}</div>
              </div>
              <div className="rounded-md border bg-card p-3">
                <div className="font-mono text-lg font-semibold">{marketCatalog.filter((item) => item.kind === "community").length}</div>
                <div className="mt-1 text-xs text-muted-foreground">{language === "zh-CN" ? "社区" : "Community"}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {sections.map((section) => (
        <MarketSectionBlock
          key={section.kind}
          section={section}
          language={language}
          ownedStrategies={ownedStrategies}
          onFavorite={handleFavorite}
          onPurchase={handlePurchase}
          onPreview={handlePreview}
          onBacktest={handleBacktest}
          backtestingId={backtestingId}
          onOpenLibrary={handleOpenLibrary}
        />
      ))}

      {backtestSelection && (
        <section className="border-b bg-card">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  {language === "zh-CN" ? "回测结果" : "Backtest result"}
                </div>
                <h2 className="mt-3 text-xl font-semibold tracking-normal">{backtestSelection.item.name}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{backtestSelection.summary.symbol} · {backtestSelection.summary.timeframe} · {backtestSelection.summary.period}</span>
                  <span
                    className={
                      backtestSelection.summary.status === "passed"
                        ? "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                        : "rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive"
                    }
                  >
                    {backtestSelection.summary.status === "passed" ? copy.backtestPassed : copy.backtestFailed}
                  </span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {backtestSelection.summary.engine} · {backtestSelection.summary.assumptions.join(" / ")}
                </p>
                {backtestSelection.summary.run_id && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    run_id: <span className="font-mono">{backtestSelection.summary.run_id}</span>
                  </p>
                )}
                {backtestSelection.summary.warnings?.length ? (
                  <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
                    {backtestSelection.summary.warnings.join(" / ")}
                  </div>
                ) : null}
                {(backtestSelection.item.usage?.length || backtestSelection.item.riskNotes?.length) && (
                  <div className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground sm:grid-cols-2">
                    {backtestSelection.item.usage?.length ? (
                      <div className="rounded-md border bg-background px-3 py-2">
                        <div className="font-semibold text-foreground">{language === "zh-CN" ? "使用方式" : "Usage"}</div>
                        <p className="mt-1">{backtestSelection.item.usage.join(" · ")}</p>
                      </div>
                    ) : null}
                    {backtestSelection.item.riskNotes?.length ? (
                      <div className="rounded-md border bg-background px-3 py-2">
                        <div className="font-semibold text-foreground">{language === "zh-CN" ? "风控要点" : "Risk notes"}</div>
                        <p className="mt-1">{backtestSelection.item.riskNotes.join(" · ")}</p>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleDeployPaper}
                disabled={deployingId === backtestSelection.item.id || backtestSelection.summary.status !== "passed"}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
              >
                <Rocket className="h-4 w-4" />
                {deployingId === backtestSelection.item.id
                  ? (language === "zh-CN" ? "启动中" : "Starting")
                  : (language === "zh-CN" ? "跑模拟盘" : "Run paper")}
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {[
                [language === "zh-CN" ? "总收益" : "Total return", `${backtestSelection.summary.totalReturnPct}%`],
                [language === "zh-CN" ? "年化收益" : "Annualized", `${backtestSelection.summary.annualizedReturnPct}%`],
                [language === "zh-CN" ? "最大回撤" : "Max drawdown", `${backtestSelection.summary.maxDrawdownPct}%`],
                ["Sharpe", backtestSelection.summary.sharpe.toFixed(2)],
                [language === "zh-CN" ? "胜率" : "Win rate", `${backtestSelection.summary.winRatePct}%`],
                [language === "zh-CN" ? "交易数" : "Trades", String(backtestSelection.summary.tradeCount)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border bg-background p-3">
                  <div className="text-xs font-medium text-muted-foreground">{label}</div>
                  <div className="mt-1 font-mono text-lg font-semibold">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="mx-auto max-w-7xl px-4 py-4 text-sm text-muted-foreground sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
          <BadgeCheck className="h-4 w-4 text-primary" />
          <span>{copy.sectionHint}</span>
        </div>
      </div>
    </main>
  );
}
