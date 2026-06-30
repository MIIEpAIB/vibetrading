import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Gauge,
  Layers,
  Library,
  Play,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { api, type ShadowAccountResponse, type StrategyLibraryItem } from "@/lib/api";
import { useTranslation } from "@/i18n/I18nProvider";
import type { LanguageCode } from "@/i18n/translations";
import { cn } from "@/lib/utils";

const LOCAL_STRATEGY_KEY = "vibe-personal-strategy-library";

type TrackId = "trader" | "quant" | "practice";
type StageState = "done" | "active" | "locked";

const copy: Record<LanguageCode, {
  title: string;
  kicker: string;
  subtitle: string;
  primary: string;
  secondary: string;
  tracks: Record<TrackId, {
    title: string;
    desc: string;
    bullets: string[];
    action: string;
    prompt?: string;
  }>;
  metrics: {
    strategies: string;
    shadowOrders: string;
    readiness: string;
    liveMode: string;
  };
  sections: {
    path: string;
    pathDesc: string;
    readiness: string;
    readinessDesc: string;
    exchange: string;
    exchangeDesc: string;
    assets: string;
    next: string;
  };
  actions: {
    alpha: string;
    strategy: string;
    shadow: string;
    liveReview: string;
  };
  stages: Array<{ title: string; desc: string }>;
  checks: Array<{ title: string; desc: string }>;
  exchanges: Array<{ name: string; status: string; desc: string }>;
  livePrompt: string;
  emptyStrategy: string;
  emptyShadow: string;
}> = {
  "en-US": {
    kicker: "Strategy driving school",
    title: "Turn ideas into shadow-tested crypto strategies before live exchange access.",
    subtitle:
      "A beginner-first workflow for traders learning quant validation and quants learning trade execution. The live path stays gated by connector mandates and explicit user approval.",
    primary: "Start with AI coach",
    secondary: "Open shadow training",
    tracks: {
      trader: {
        title: "I understand trading",
        desc: "Translate entry, exit, sizing, and stop rules into a testable strategy.",
        bullets: ["plain-language rules", "backtest plan", "risk checklist"],
        action: "Build from trade idea",
        prompt:
          "Act as a beginner-friendly quant coach. I understand trading but not quant implementation. Help me turn my trading idea into a structured crypto strategy for BTC/ETH/SOL spot first. Ask only the missing questions, then produce entry rules, exit rules, position sizing, stop loss, take profit, backtest plan, shadow-trading observation plan, and live-readiness gates. Do not place orders.",
      },
      quant: {
        title: "I understand quant",
        desc: "Convert alpha, IC, and model output into executable exchange rules.",
        bullets: ["cost-aware execution", "liquidity checks", "shadow score"],
        action: "Trade-proof my signal",
        prompt:
          "Act as a crypto execution mentor for a quant user. I have alpha or model signals but need tradeable rules. Convert the signal into an OKX/Binance spot strategy with symbol mapping, rebalance cadence, fee/slippage assumptions, order type choices, position limits, shadow-trading observation gates, and live mandate limits. Keep it read-only and do not place orders.",
      },
      practice: {
        title: "I want to practice first",
        desc: "Use the virtual portfolio as the training ground before any real money.",
        bullets: ["virtual wallet", "order flow", "promotion gates"],
        action: "Open shadow simulator",
      },
    },
    metrics: {
      strategies: "Strategies",
      shadowOrders: "Shadow orders",
      readiness: "Live readiness",
      liveMode: "Live mode",
    },
    sections: {
      path: "Lifecycle path",
      pathDesc: "Every beginner route ends in the same evidence trail.",
      readiness: "Shadow readiness",
      readinessDesc: "A lightweight score from current strategy and virtual-order evidence.",
      exchange: "Exchange bridge",
      exchangeDesc: "Live crypto access starts with spot, confirmation mode, and small mandates.",
      assets: "Current assets",
      next: "Suggested next step",
    },
    actions: {
      alpha: "Browse Alpha Zoo",
      strategy: "Open Strategy Library",
      shadow: "Open Shadow Trading",
      liveReview: "Ask for live-readiness review",
    },
    stages: [
      { title: "Draft", desc: "Idea, alpha, or journal is converted into a strategy card." },
      { title: "Backtest", desc: "Costs, slippage, benchmark, and failure cases are checked." },
      { title: "Shadow train", desc: "The strategy runs in a virtual crypto account." },
      { title: "Readiness review", desc: "AI reviews drawdown, fills, costs, and rule discipline." },
      { title: "Connector setup", desc: "OKX/Binance profile is verified with withdrawal disabled." },
      { title: "Live pilot", desc: "Small spot-only mandate, confirm mode, auto-expiry, kill switch." },
    ],
    checks: [
      { title: "No direct promotion", desc: "A strategy edit or failed shadow run returns to observation." },
      { title: "Spot first", desc: "Perpetuals and leverage require a separate advanced review." },
      { title: "Mandate only", desc: "Live orders require user-confirmed symbols, size, loss cap, and expiry." },
      { title: "One-click halt", desc: "Runtime can be stopped immediately; failed checks fall back to read-only." },
    ],
    exchanges: [
      { name: "OKX", status: "Priority", desc: "Spot pilot, USDT pairs, connector mandate gate." },
      { name: "Binance", status: "Priority", desc: "Spot pilot, fee/slippage model, confirmation mode." },
      { name: "Bybit / Coinbase / Kraken", status: "Later", desc: "Use the same shadow-score and mandate contract." },
    ],
    livePrompt:
      "Review this workspace for crypto live-readiness. Use my current strategy library and shadow-trading evidence. Decide whether any strategy is ready for an OKX/Binance spot pilot. If yes, propose a conservative mandate with symbols, max order size, max notional, daily loss cap, expiry, confirm-mode first, and kill-switch rules. If not, list the missing shadow evidence. Do not place orders.",
    emptyStrategy: "No saved strategies yet. Start with a coach track or Alpha Zoo.",
    emptyShadow: "No shadow orders yet. Train in the virtual portfolio before live review.",
  },
  "zh-CN": {
    kicker: "策略驾校",
    title: "先把策略放进影子系统训练，再过渡到加密交易所实盘。",
    subtitle:
      "面向新手的统一流程：懂交易的人学会量化验证，懂量化的人补齐交易执行。实盘路径继续受连接器授权、mandate 和用户确认保护。",
    primary: "从智能体教练开始",
    secondary: "进入影子训练",
    tracks: {
      trader: {
        title: "我懂交易",
        desc: "把入场、出场、仓位、止损这些交易语言翻译成可测试策略。",
        bullets: ["通俗规则", "回测方案", "风控清单"],
        action: "用交易想法生成策略",
        prompt:
          "你是面向新手的量化教练。我懂交易但不懂量化实现。请帮我把交易想法转成结构化加密策略，优先覆盖 BTC/ETH/SOL 现货。先问必要的缺失问题，然后输出入场规则、出场规则、仓位管理、止损、止盈、回测方案、影子模拟观察计划和实盘晋级门槛。不要下单。",
      },
      quant: {
        title: "我懂量化",
        desc: "把 Alpha、IC 和模型信号转成能在交易所执行的规则。",
        bullets: ["成本敏感执行", "流动性检查", "影子评分"],
        action: "检查信号能否交易",
        prompt:
          "你是加密交易执行导师，面向懂量化但不熟交易的用户。我有 Alpha 或模型信号，需要转成可交易规则。请把信号转成 OKX/Binance 现货策略，包含 symbol 映射、调仓频率、手续费/滑点假设、订单类型、仓位限制、影子模拟观察门槛和实盘 mandate 限制。保持只读，不要下单。",
      },
      practice: {
        title: "我想先练习",
        desc: "先用虚拟组合训练，不直接接触真钱。",
        bullets: ["虚拟钱包", "订单流", "晋级门槛"],
        action: "打开影子模拟盘",
      },
    },
    metrics: {
      strategies: "策略数",
      shadowOrders: "影子订单",
      readiness: "实盘准备度",
      liveMode: "实盘模式",
    },
    sections: {
      path: "策略生命周期",
      pathDesc: "所有新手入口最终都沉淀成同一条证据链。",
      readiness: "影子准备度",
      readinessDesc: "基于当前策略库和虚拟订单证据的轻量评分。",
      exchange: "交易所过渡",
      exchangeDesc: "加密实盘从现货、小额、确认模式和 mandate 开始。",
      assets: "当前资产",
      next: "建议下一步",
    },
    actions: {
      alpha: "浏览 Alpha 库",
      strategy: "打开策略库",
      shadow: "打开影子模拟盘",
      liveReview: "让智能体做实盘准备审查",
    },
    stages: [
      { title: "草稿", desc: "交易想法、Alpha 或交易日志转成策略档案。" },
      { title: "回测", desc: "检查成本、滑点、基准和失败场景。" },
      { title: "影子训练", desc: "策略进入虚拟加密账户运行。" },
      { title: "准备度审查", desc: "AI 审查回撤、成交、成本和纪律。" },
      { title: "连接器设置", desc: "验证 OKX/Binance 档案，禁止提现权限。" },
      { title: "小额实盘", desc: "现货、小额 mandate、确认模式、自动过期和一键停止。" },
    ],
    checks: [
      { title: "不能直接晋级", desc: "策略修改或影子失败后必须回到观察期。" },
      { title: "先做现货", desc: "永续和杠杆需要单独的高级审查。" },
      { title: "只在 mandate 内", desc: "实盘订单必须由用户确认标的、额度、亏损上限和有效期。" },
      { title: "一键停止", desc: "运行时可立即停止；检查失败自动降级只读。" },
    ],
    exchanges: [
      { name: "OKX", status: "优先", desc: "现货试运行、USDT 交易对、连接器 mandate 门禁。" },
      { name: "Binance", status: "优先", desc: "现货试运行、手续费/滑点模型、确认模式。" },
      { name: "Bybit / Coinbase / Kraken", status: "后续", desc: "复用同一套影子评分和 mandate 合约。" },
    ],
    livePrompt:
      "请审查当前工作区是否具备加密实盘准备度。使用我的策略库和影子模拟证据，判断是否有策略适合进入 OKX/Binance 现货小额试运行。如果可以，请提出保守 mandate：交易标的、最大单笔、最大名义金额、每日亏损上限、授权有效期、先用确认模式和一键停止规则。如果不可以，请列出缺失的影子证据。不要下单。",
    emptyStrategy: "还没有保存策略。可以先从教练入口或 Alpha 库开始。",
    emptyShadow: "还没有影子订单。请先在虚拟组合中训练，再做实盘审查。",
  },
};

function readLocalStrategies(): StrategyLibraryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STRATEGY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is StrategyLibraryItem => {
        if (!item || typeof item !== "object") return false;
        const row = item as Record<string, unknown>;
        return typeof row.id === "string" && typeof row.name === "string" && typeof row.code === "string";
      })
      .map((item) => ({
        ...item,
        description: item.description || "",
        language: item.language || "python",
        category: item.category || "utility",
        status: item.status || "draft",
        tags: Array.isArray(item.tags) ? item.tags : [],
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function openAgentWithPrompt(navigate: ReturnType<typeof useNavigate>, prompt: string) {
  const key = `cockpit_prompt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(key, prompt);
  navigate(`/agent?promptKey=${encodeURIComponent(key)}&auto=1`);
}

function readinessColor(score: number): string {
  if (score >= 80) return "text-success";
  if (score >= 55) return "text-warning";
  return "text-muted-foreground";
}

export function StrategyCockpit() {
  const { language } = useTranslation();
  const navigate = useNavigate();
  const c = copy[language];
  const [strategies, setStrategies] = useState<StrategyLibraryItem[]>(() => readLocalStrategies());
  const [shadow, setShadow] = useState<ShadowAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.listStrategies(), api.getShadowAccount()])
      .then(([strategyResult, shadowResult]) => {
        if (cancelled) return;
        if (strategyResult.status === "fulfilled") {
          setStrategies(strategyResult.value.strategies);
        }
        if (shadowResult.status === "fulfilled") {
          setShadow(shadowResult.value);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const orders = shadow?.orders ?? [];
    const filled = orders.filter((order) => order.status === "FILLED").length;
    const pending = orders.filter((order) => order.status === "PENDING").length;
    const rejected = orders.filter((order) => order.status === "REJECTED").length;
    const testing = strategies.filter((strategy) => ["testing", "live"].includes(strategy.status)).length;
    const score = Math.min(
      100,
      22
        + Math.min(strategies.length, 4) * 7
        + Math.min(testing, 3) * 6
        + Math.min(filled, 5) * 7
        + (orders.length > 0 ? 8 : 0)
        + (rejected === 0 ? 8 : 0)
        + (pending > 0 ? 5 : 0),
    );
    const usdt = shadow?.wallets.find((wallet) => wallet.asset_name === "USDT");
    return {
      orders: orders.length,
      filled,
      pending,
      rejected,
      score,
      usdtBalance: usdt?.balance ?? 0,
      usdtFrozen: usdt?.frozen ?? 0,
    };
  }, [shadow, strategies]);

  const stages = useMemo(() => {
    return c.stages.map((stage, index) => {
      let state: StageState = "locked";
      if (index === 0 && strategies.length > 0) state = "done";
      if (index === 1 && strategies.some((strategy) => ["testing", "live"].includes(strategy.status))) state = "done";
      if (index === 2 && stats.orders > 0) state = "done";
      if (index === 3 && stats.score >= 70) state = "done";
      if (index === 4 && stats.score >= 80) state = "active";
      if (index === 5 && stats.score >= 90) state = "active";
      if (state === "locked") {
        const firstLocked = [
          strategies.length === 0,
          !strategies.some((strategy) => ["testing", "live"].includes(strategy.status)),
          stats.orders === 0,
          stats.score < 70,
          stats.score < 80,
          stats.score < 90,
        ].findIndex(Boolean);
        if (firstLocked === index) state = "active";
      }
      return { ...stage, state };
    });
  }, [c.stages, stats.orders, stats.score, strategies]);

  const nextStep = useMemo(() => {
    if (strategies.length === 0) return c.emptyStrategy;
    if (stats.orders === 0) return c.emptyShadow;
    if (stats.score < 70) return language === "zh-CN" ? "继续影子观察，补齐成交、成本和回撤证据。" : "Keep observing in shadow mode until fills, costs, and drawdown evidence improve.";
    return language === "zh-CN" ? "可以让智能体生成保守的现货实盘 mandate 提案。" : "Ask the agent for a conservative spot live mandate proposal.";
  }, [c.emptyShadow, c.emptyStrategy, language, stats.orders, stats.score, strategies.length]);

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-5 md:px-6 md:py-7">
        <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {c.kicker}
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
              {c.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {c.subtitle}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => openAgentWithPrompt(navigate, c.tracks.trader.prompt || "")}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              <Bot className="h-4 w-4" />
              {c.primary}
            </button>
            <Link
              to="/shadow-trading"
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <WalletCards className="h-4 w-4" />
              {c.secondary}
            </Link>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric
            icon={Library}
            label={c.metrics.strategies}
            value={String(strategies.length)}
            sub={loading ? "..." : `${strategies.filter((s) => s.status === "testing").length} testing`}
          />
          <Metric
            icon={WalletCards}
            label={c.metrics.shadowOrders}
            value={String(stats.orders)}
            sub={`${stats.filled} filled / ${stats.pending} pending`}
          />
          <Metric
            icon={Gauge}
            label={c.metrics.readiness}
            value={`${stats.score}/100`}
            sub={stats.score >= 70 ? c.actions.liveReview : c.sections.next}
            tone={readinessColor(stats.score)}
          />
          <Metric
            icon={ShieldCheck}
            label={c.metrics.liveMode}
            value={stats.score >= 80 ? "Pilot" : "Locked"}
            sub={language === "zh-CN" ? "需用户确认 mandate" : "requires mandate"}
          />
        </section>

        <main className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-lg border bg-card">
            <div className="border-b p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">{c.sections.readiness}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{c.sections.readinessDesc}</p>
                </div>
                <div className="text-right">
                  <div className={cn("text-4xl font-semibold", readinessColor(stats.score))}>{stats.score}</div>
                  <div className="text-xs text-muted-foreground">/100</div>
                </div>
              </div>
              <div className="mt-5 h-2 rounded-full bg-muted">
                <div
                  className={cn("h-2 rounded-full", stats.score >= 80 ? "bg-success" : stats.score >= 55 ? "bg-warning" : "bg-primary")}
                  style={{ width: `${stats.score}%` }}
                />
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                <span className="font-medium text-foreground">{c.sections.next}: </span>
                {nextStep}
              </p>
            </div>

            <div className="grid gap-0 md:grid-cols-2">
              <div className="border-b p-5 md:border-b-0 md:border-r">
                <h3 className="text-sm font-semibold">{language === "zh-CN" ? "选择入口" : "Choose a path"}</h3>
                <div className="mt-4 space-y-2">
                  {(Object.keys(c.tracks) as TrackId[]).map((trackId) => {
                    const track = c.tracks[trackId];
                    const Icon = trackId === "trader" ? TrendingUp : trackId === "quant" ? Layers : Play;
                    const onClick = () => {
                      if (track.prompt) openAgentWithPrompt(navigate, track.prompt);
                      else navigate("/shadow-trading");
                    };
                    return (
                      <button
                        key={trackId}
                        onClick={onClick}
                        className="group flex w-full items-center gap-3 rounded-md border bg-background p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-primary">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{track.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{track.desc}</span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-5">
                <h3 className="text-sm font-semibold">{language === "zh-CN" ? "证据" : "Evidence"}</h3>
                <div className="mt-4 space-y-3 text-sm">
                  <ReadinessRow
                    label={language === "zh-CN" ? "策略档案" : "Strategy evidence"}
                    ok={strategies.length > 0}
                    language={language}
                  />
                  <ReadinessRow
                    label={language === "zh-CN" ? "测试状态" : "Testing state"}
                    ok={strategies.some((strategy) => ["testing", "live"].includes(strategy.status))}
                    language={language}
                  />
                  <ReadinessRow
                    label={language === "zh-CN" ? "影子订单" : "Shadow orders"}
                    ok={stats.orders > 0}
                    language={language}
                  />
                  <ReadinessRow
                    label={language === "zh-CN" ? "拒单记录" : "Rejected orders"}
                    ok={stats.rejected === 0}
                    warn={stats.rejected > 0}
                    language={language}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t p-5">
              <LinkButton to="/alpha-zoo" icon={Layers} label={c.actions.alpha} />
              <LinkButton to="/strategies" icon={Library} label={c.actions.strategy} />
              <LinkButton to="/shadow-trading" icon={WalletCards} label={c.actions.shadow} />
              <button
                onClick={() => openAgentWithPrompt(navigate, c.livePrompt)}
                className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
              >
                <Sparkles className="h-4 w-4" />
                {c.actions.liveReview}
              </button>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-base font-semibold">{c.sections.path}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{c.sections.pathDesc}</p>
              <div className="mt-5 space-y-4">
                {stages.slice(0, 5).map((stage, index) => (
                  <div key={stage.title} className="flex gap-3">
                    <span className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                      stage.state === "done" && "bg-success/10 text-success",
                      stage.state === "active" && "bg-primary/10 text-primary",
                      stage.state === "locked" && "bg-muted text-muted-foreground",
                    )}>
                      {stage.state === "done" ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                    </span>
                    <div>
                      <div className="text-sm font-medium">{stage.title}</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{stage.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-card p-5">
              <h2 className="text-base font-semibold">{c.sections.exchange}</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{c.sections.exchangeDesc}</p>
              <div className="mt-4 divide-y">
                {c.exchanges.slice(0, 2).map((exchange) => (
                  <div key={exchange.name} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div>
                      <div className="text-sm font-medium">{exchange.name}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{exchange.desc}</div>
                    </div>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{exchange.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={cn("mt-1 truncate text-2xl font-semibold", tone)}>{value}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">{sub}</div>
        </div>
        <span className="rounded-md bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function ReadinessRow({
  label,
  ok,
  warn,
  language,
}: {
  label: string;
  ok: boolean;
  warn?: boolean;
  language: LanguageCode;
}) {
  const status = warn
    ? language === "zh-CN" ? "需复核" : "review"
    : ok
      ? language === "zh-CN" ? "已就绪" : "ready"
      : language === "zh-CN" ? "缺失" : "missing";

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        "rounded-md px-2 py-0.5 text-xs font-medium",
        ok && !warn && "bg-success/10 text-success",
        warn && "bg-warning/10 text-warning",
        !ok && !warn && "bg-muted text-muted-foreground",
      )}>
        {status}
      </span>
    </div>
  );
}

function LinkButton({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  );
}
