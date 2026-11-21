import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  Library,
  Play,
  ShoppingBag,
  Sparkles,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api, type StrategyLibraryItem, type StrategyMarketAdminItem } from "@/lib/api";
import { useTranslation } from "@/i18n/I18nProvider";
import {
  createMarketOwnedStrategy,
  getStrategyRouteId,
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

function catalogItemToStrategy(item: StrategyMarketAdminItem): StrategyCatalogItem {
  return {
    id: item.id,
    name: item.name || item.id,
    summary: item.summary || item.description || item.note || item.name || item.id,
    author: item.author,
    assets: item.assets ?? [],
    oneYearSharpe: item.one_year_sharpe ?? undefined,
    fiveYearCagr: item.five_year_cagr ?? undefined,
    fiveYearDrawdown: item.five_year_drawdown ?? undefined,
    oosThreeMonthReturn: item.oos_three_month_return ?? undefined,
    oosThreeMonthSharpe: item.oos_three_month_sharpe ?? undefined,
    oosOneYearSharpe: item.oos_one_year_sharpe ?? undefined,
    publishedAt: item.published_at,
    followers: item.followers,
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
      "Built-in and community strategies can be saved to your library. Paid strategy checkout is not enabled yet.",
    openLibrary: "Open my library",
    sectionHint: "Saved items move into your private strategy library.",
    saved: "Saved",
    backtest: "Backtest",
    backtestPassed: "Backtest passed",
    backtestFailed: "Backtest failed",
    preview: "Preview",
    favorite: "Favorite",
    checkoutUnavailable: "Checkout unavailable",
    columns: { name: "Name", assets: "Assets", sharpe: "1Y Sharpe", drawdown: "5Y Drawdown", oosReturn: "OOS 3M Return", oosSharpe3m: "OOS 3M Sharpe", oosSharpe1y: "OOS 1Y Sharpe", published: "Published" },
    builtIn: {
      title: "Built-in strategies",
      description: "Platform strategies with direct backtest and favorite actions.",
    },
    paid: {
      title: "Paid strategies",
      description: "Checkout is not configured yet. Paid items cannot be added to your library until purchase is implemented.",
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
      "内置和社区策略可以保存到策略库；付费策略的结算功能尚未开放。",
    openLibrary: "打开我的策略库",
    sectionHint: "已保存的条目会进入你的私有策略库。",
    saved: "已保存",
    backtest: "回测",
    backtestPassed: "回测通过",
    backtestFailed: "回测未通过",
    preview: "预览",
    favorite: "收藏",
    checkoutUnavailable: "暂不可购买",
    columns: { name: "名称", assets: "标的", sharpe: "1 年夏普", drawdown: "5 年回撤", oosReturn: "样本外 3 个月收益", oosSharpe3m: "样本外 3 个月夏普", oosSharpe1y: "样本外 1 年夏普", published: "发布时间" },
    builtIn: {
      title: "内置策略",
      description: "平台策略，可直接回测并收藏到自己的策略库。",
    },
    paid: {
      title: "付费策略",
      description: "购买结算尚未配置；购买功能上线前，付费策略不会添加到你的策略库。",
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

function formatMetricValue(value: number | undefined, suffix = "") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}${suffix}`;
}

function formatPublishedDate(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function MarketCard({
  item,
  actionLabel,
  onAction,
  kind,
  disabled,
}: {
  item: StrategyCatalogItem;
  actionLabel: string;
  onAction: () => void;
  kind: "built-in" | "paid" | "community";
  disabled?: boolean;
}) {
  const price = item.price ? <span className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{item.price}</span> : null;

  return (
    <tr className="border-b last:border-b-0">
      <td className="min-w-[18rem] px-3 py-2 align-middle">
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link
              to={`/strategy/${encodeURIComponent(getStrategyRouteId(item.id))}`}
              className="min-w-0 truncate text-sm font-semibold leading-5 text-foreground transition hover:text-primary"
            >
              {item.name}
            </Link>
            {price}
          </div>
        </div>
      </td>
      <td className="min-w-[9rem] whitespace-nowrap px-3 py-2 align-middle font-mono text-xs text-foreground">{item.assets?.length ? item.assets.join(", ") : "-"}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right align-middle font-mono text-sm text-foreground">{formatMetricValue(item.oneYearSharpe)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right align-middle font-mono text-sm text-foreground">{formatMetricValue(item.fiveYearDrawdown, "%")}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right align-middle font-mono text-sm text-foreground">{formatMetricValue(item.oosThreeMonthReturn, "%")}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right align-middle font-mono text-sm text-foreground">{formatMetricValue(item.oosThreeMonthSharpe)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right align-middle font-mono text-sm text-foreground">{formatMetricValue(item.oosOneYearSharpe)}</td>
      <td className="min-w-[7rem] whitespace-nowrap px-3 py-2 align-middle font-mono text-xs text-foreground">{formatPublishedDate(item.publishedAt)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right align-middle">
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          title={disabled ? actionLabel : undefined}
          className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {kind === "built-in" ? <Star className="h-4 w-4 shrink-0" /> : kind === "community" ? <Library className="h-4 w-4 shrink-0" /> : <ShoppingBag className="h-4 w-4 shrink-0" />}
          <span className="truncate">{actionLabel}</span>
        </button>
      </td>
    </tr>
  );
}

function MarketSectionBlock({
  section,
  language,
  ownedStrategies,
  onFavorite,
  onOpenLibrary,
}: {
  section: MarketSection;
  language: "en-US" | "zh-CN";
  ownedStrategies: StrategyLibraryItem[];
  onFavorite: (item: StrategyCatalogItem) => void;
  onOpenLibrary: () => void;
}) {
  const headerTitle = language === "zh-CN" ? section.titleZh : section.titleEn;
  const headerDescription = language === "zh-CN" ? section.descriptionZh : section.descriptionEn;
  const copy = MARKET_COPY[language];

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
        <div className="mt-4 overflow-x-auto rounded-md border bg-card">
          <table className="w-full min-w-[58rem] border-collapse text-left">
            <thead className="border-b bg-muted/40 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">{copy.columns.name}</th>
                <th className="whitespace-nowrap px-3 py-2">{copy.columns.assets}</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">{copy.columns.sharpe}</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">{copy.columns.drawdown}</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">{copy.columns.oosReturn}</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">{copy.columns.oosSharpe3m}</th>
                <th className="whitespace-nowrap px-3 py-2 text-right">{copy.columns.oosSharpe1y}</th>
                <th className="whitespace-nowrap px-3 py-2">{copy.columns.published}</th>
                <th className="whitespace-nowrap px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {section.items.map((item) => {
                const ownedRecord = ownedStrategies.find((strategy) => strategy.id === item.id || strategy.id === `owned_${item.id}`);
                const isOwned = Boolean(ownedRecord);
                const checkoutUnavailable = section.kind === "paid" && !isOwned;
                return (
                  <MarketCard
                    key={item.id}
                    item={item}
                    kind={section.kind}
                    actionLabel={
                      isOwned
                        ? (language === "zh-CN" ? "去策略库" : "Open library")
                        : section.kind === "built-in"
                          ? (language === "zh-CN" ? MARKET_COPY["zh-CN"].favorite : MARKET_COPY["en-US"].favorite)
                          : section.kind === "community"
                            ? (language === "zh-CN" ? "保存" : "Save")
                            : copy.checkoutUnavailable
                    }
                    disabled={checkoutUnavailable}
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
                    }}
                  />
                );
              })}
            </tbody>
          </table>
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
          onOpenLibrary={handleOpenLibrary}
        />
      ))}

      <div className="mx-auto max-w-7xl px-4 py-4 text-sm text-muted-foreground sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
          <BadgeCheck className="h-4 w-4 text-primary" />
          <span>{copy.sectionHint}</span>
        </div>
      </div>
    </main>
  );
}
