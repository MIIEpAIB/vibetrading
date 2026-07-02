import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Eye,
  Heart,
  MessageCircle,
  Star,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { api, type StrategyLibraryItem } from "@/lib/api";
import { useTranslation } from "@/i18n/I18nProvider";
import {
  createMarketOwnedStrategy,
  findMarketStrategyByRouteId,
  getStrategyRouteId,
  resolveStrategyRouteId,
} from "@/lib/strategyMarketplace";
import {
  normalizeOwnedStrategy,
  readOwnedStrategies,
  saveOwnedStrategies,
  upsertOwnedStrategy,
} from "@/lib/strategyStorage";

const SHARE_STATS_KEY = "vibe-strategy-share-stats";

type ShareStats = Record<string, { views: number; copies: number; favorites: number }>;

function readStats(): ShareStats {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SHARE_STATS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStats(stats: ShareStats) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SHARE_STATS_KEY, JSON.stringify(stats));
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function authorFor(strategyId: string) {
  const seed = Array.from(strategyId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const names = ["QuantClaw", "Vibe Research", "Grid Lab", "Trend Desk", "Crypto PM"];
  const name = names[seed % names.length];
  return {
    name,
    avatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`,
    following: 12 + (seed % 88),
    followers: 420 + (seed % 3200),
  };
}

function cloneStrategy(strategy: StrategyLibraryItem): StrategyLibraryItem {
  const now = new Date().toISOString();
  return {
    ...strategy,
    id: `copy_${strategy.id}_${Date.now()}`,
    name: `${strategy.name} Copy`,
    status: "draft",
    tags: Array.from(new Set([...(strategy.tags ?? []), "copied"])).slice(0, 8),
    createdAt: now,
    updatedAt: now,
  };
}

export function StrategyShare() {
  const { language } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const routeId = params.strategyId ? decodeURIComponent(params.strategyId) : "";
  const resolvedId = resolveStrategyRouteId(routeId);
  const [strategy, setStrategy] = useState<StrategyLibraryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(() => readStats());
  const [favorited, setFavorited] = useState(false);

  const copy = language === "zh-CN"
    ? {
      back: "返回策略商城",
      missing: "没有找到这个策略",
      missingHint: "它可能还没有发布，或只存在于其他账号的本地策略库。",
      type: "策略类型",
      createdAt: "创建时间",
      updatedAt: "最后修改时间",
      copies: "复制次数",
      views: "浏览量",
      favorite: "收藏",
      favorited: "已收藏",
      duplicate: "复制",
      author: "策略作者",
      follow: "关注",
      message: "私信",
      following: "关注",
      followers: "关注者",
      detail: "策略详细介绍",
      emptyDetail: "作者还没有填写策略详细介绍。",
      copied: "策略已复制到你的策略库",
      saved: "已收藏到你的策略库",
    }
    : {
      back: "Back to market",
      missing: "Strategy not found",
      missingHint: "It may not be published or only exists in another account's local library.",
      type: "Strategy Type",
      createdAt: "Created",
      updatedAt: "Last Modified",
      copies: "Copies",
      views: "Views",
      favorite: "Favorite",
      favorited: "Favorited",
      duplicate: "Copy",
      author: "Strategy Author",
      follow: "Follow",
      message: "Message",
      following: "Following",
      followers: "Followers",
      detail: "Strategy Details",
      emptyDetail: "The author has not added a detailed strategy description yet.",
      copied: "Strategy copied into your library",
      saved: "Saved to your strategy library",
    };

  useEffect(() => {
    let cancelled = false;
    const marketItem = findMarketStrategyByRouteId(routeId);
    const local = readOwnedStrategies();
    const localItem = local.find((item) => item.id === resolvedId || getStrategyRouteId(item.id) === routeId) ?? null;
    const fallback = localItem ?? (marketItem ? createMarketOwnedStrategy(marketItem, "favorite") : null);

    api.listStrategies()
      .then((payload) => {
        if (cancelled) return;
        const remote = payload.strategies.find((item) => item.id === resolvedId || getStrategyRouteId(item.id) === routeId) ?? null;
        setStrategy(remote || fallback ? normalizeOwnedStrategy(remote ?? fallback) : null);
      })
      .catch(() => {
        if (!cancelled) setStrategy(fallback ? normalizeOwnedStrategy(fallback) : null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedId, routeId]);

  useEffect(() => {
    if (!strategy) return;
    const key = getStrategyRouteId(strategy.id);
    const next = { ...readStats() };
    const current = next[key] ?? { views: 0, copies: 0, favorites: 0 };
    next[key] = { ...current, views: current.views + 1 };
    writeStats(next);
    setStats(next);
    setFavorited(readOwnedStrategies().some((item) => item.id === strategy.id));
  }, [strategy]);

  const currentStats = strategy ? stats[getStrategyRouteId(strategy.id)] ?? { views: 0, copies: 0, favorites: 0 } : { views: 0, copies: 0, favorites: 0 };
  const author = useMemo(() => authorFor(strategy?.id ?? routeId), [routeId, strategy?.id]);
  const detail = strategy?.strategyDescription?.trim() || strategy?.description?.trim() || "";

  const bump = (field: "copies" | "favorites") => {
    if (!strategy) return;
    const key = getStrategyRouteId(strategy.id);
    const next = { ...readStats() };
    const current = next[key] ?? { views: 0, copies: 0, favorites: 0 };
    next[key] = { ...current, [field]: current[field] + 1 };
    writeStats(next);
    setStats(next);
  };

  const handleFavorite = () => {
    if (!strategy) return;
    const favoriteStrategy = {
      ...strategy,
      tags: Array.from(new Set([...(strategy.tags ?? []), "favorite"])).slice(0, 8),
    };
    const next = upsertOwnedStrategy(readOwnedStrategies(), favoriteStrategy);
    saveOwnedStrategies(next);
    void api.upsertStrategy(favoriteStrategy).catch(() => undefined);
    setFavorited(true);
    bump("favorites");
    toast.success(copy.saved);
  };

  const handleCopy = () => {
    if (!strategy) return;
    const duplicated = cloneStrategy(strategy);
    const next = upsertOwnedStrategy(readOwnedStrategies(), duplicated);
    saveOwnedStrategies(next);
    void api.upsertStrategy(duplicated).catch(() => undefined);
    bump("copies");
    toast.success(copy.copied);
  };

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">{language === "zh-CN" ? "正在加载策略..." : "Loading strategy..."}</div>;
  }

  if (!strategy) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <Link to="/market" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {copy.back}
        </Link>
        <section className="mt-8 rounded-lg border bg-card p-8 text-center">
          <h1 className="text-xl font-semibold">{copy.missing}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.missingHint}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-full bg-background">
      <section className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <Link to="/market" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {copy.back}
          </Link>
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                {strategy.tags.map((tag) => (
                  <span key={tag} className="rounded border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">{tag}</span>
                ))}
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">{strategy.name}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">{strategy.description}</p>
              <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                <Meta label={copy.type} value={strategy.category} />
                <Meta label={copy.createdAt} value={formatDate(strategy.createdAt)} />
                <Meta label={copy.updatedAt} value={formatDate(strategy.updatedAt)} />
                <Meta label={copy.copies} value={String(currentStats.copies)} />
                <Meta label={copy.views} value={String(currentStats.views)} />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleFavorite}
                  className="inline-flex items-center gap-2 rounded-md border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted"
                >
                  <Heart className="h-4 w-4 text-primary" />
                  {favorited ? copy.favorited : copy.favorite}
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Copy className="h-4 w-4" />
                  {copy.duplicate}
                </button>
              </div>
            </div>

            <aside className="rounded-lg border bg-background p-4">
              <div className="text-xs font-semibold uppercase text-muted-foreground">{copy.author}</div>
              <div className="mt-3 flex items-center gap-3">
                <img src={author.avatar} alt="" className="h-12 w-12 rounded-full border bg-card" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{author.name}</div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Star className="h-3.5 w-3.5 text-primary" />
                    Strategy Creator
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted">
                  <UserPlus className="h-4 w-4" />
                  {copy.follow}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/messages")}
                  className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted"
                >
                  <MessageCircle className="h-4 w-4" />
                  {copy.message}
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Meta label={copy.following} value={String(author.following)} />
                <Meta label={copy.followers} value={String(author.followers)} />
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Eye className="h-4 w-4 text-primary" />
          {copy.detail}
        </div>
        <article className="prose prose-sm max-w-none rounded-lg border bg-card p-5 text-foreground dark:prose-invert prose-img:rounded-lg prose-img:border">
          {detail ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail}</ReactMarkdown> : <p>{copy.emptyDetail}</p>}
        </article>
      </section>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}
