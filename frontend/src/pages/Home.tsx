import { Link } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  CandlestickChart,
  CircleDollarSign,
  Gauge,
  LineChart,
  Play,
  Radar,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useTranslation } from "@/i18n/I18nProvider";

const marketRows = [
  { symbol: "BTC/USDT", biasKey: "home.market.long", price: "104,820", change: "+2.84%", tone: "text-emerald-300" },
  { symbol: "NVDA", biasKey: "home.market.watch", price: "182.16", change: "+1.17%", tone: "text-sky-300" },
  { symbol: "CSI 300", biasKey: "home.market.hedge", price: "3,946", change: "-0.31%", tone: "text-rose-300" },
] as const;

const strategyCards = [
  { titleKey: "home.strategy.momentum.title", value: "+18.7%", labelKey: "home.strategy.momentum.label", icon: TrendingUp },
  { titleKey: "home.strategy.risk.title", value: "0.42", labelKey: "home.strategy.risk.label", icon: ShieldCheck },
  { titleKey: "home.strategy.alpha.title", value: "27", labelKey: "home.strategy.alpha.label", icon: BrainCircuit },
] as const;

const eventRows = [
  { time: "09:41", textKey: "home.event.backtest", tagKey: "home.eventTag.backtest" },
  { time: "09:38", textKey: "home.event.guard", tagKey: "home.eventTag.guard" },
  { time: "09:32", textKey: "home.event.signal", tagKey: "home.eventTag.signal" },
] as const;

const watchlist = [
  { nameKey: "home.watchlist.ai", score: "91", color: "bg-emerald-400" },
  { nameKey: "home.watchlist.asia", score: "76", color: "bg-sky-400" },
  { nameKey: "home.watchlist.crypto", score: "68", color: "bg-orange-400" },
] as const;

function MiniBars() {
  const bars = [34, 58, 45, 73, 62, 88, 54, 78, 96, 66, 84, 72];
  return (
    <div className="flex h-24 items-end gap-1.5" aria-hidden="true">
      {bars.map((height, index) => (
        <div
          key={`${height}-${index}`}
          className="w-full rounded-t-sm bg-gradient-to-t from-emerald-500/25 via-emerald-300/70 to-white"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

function SignalLine() {
  return (
    <svg className="h-20 w-full" viewBox="0 0 320 90" role="img" aria-label="Strategy equity curve">
      <defs>
        <linearGradient id="home-equity-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 68 C28 62 32 40 56 45 C82 50 82 22 112 28 C142 34 143 66 176 54 C208 42 206 17 238 22 C272 28 278 10 320 18 L320 90 L0 90 Z"
        fill="url(#home-equity-fill)"
      />
      <path
        d="M0 68 C28 62 32 40 56 45 C82 50 82 22 112 28 C142 34 143 66 176 54 C208 42 206 17 238 22 C272 28 278 10 320 18"
        fill="none"
        stroke="#6ee7b7"
        strokeLinecap="round"
        strokeWidth="3"
      />
    </svg>
  );
}

export function Home() {
  const { t } = useTranslation();

  return (
    <div className="min-h-full overflow-hidden bg-[#050505] text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_45%_at_50%_-15%,rgba(120,119,198,0.18),transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div className="absolute left-[8%] top-[12%] h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-[8%] right-[4%] h-80 w-80 rounded-full bg-orange-500/10 blur-3xl" />
      </div>

      <section className="relative mx-auto grid min-h-full max-w-7xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-10 lg:py-10 xl:gap-12">
        <div className="flex min-h-[calc(100vh-5rem)] flex-col justify-between gap-8">
          <div className="space-y-8">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-zinc-200 shadow-2xl shadow-black/30 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-orange-300" />
                {t("home.badge.ai")}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                {t("home.badge.online")}
              </div>
            </div>

            <div className="max-w-3xl space-y-5">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-white sm:text-5xl lg:text-6xl">
                {t("home.hero.title")}
              </h1>
              <p className="max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
                {t("home.hero.subtitle")}
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/agent"
                  className="inline-flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-400"
                >
                  {t("home.cta.start")} <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/alpha-zoo"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.1]"
                >
                  <Play className="h-4 w-4" />
                  {t("home.cta.alphaZoo")}
                </Link>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {strategyCards.map(({ titleKey, value, labelKey, icon: Icon }) => (
                <div key={titleKey} className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/20 backdrop-blur">
                  <div className="mb-4 flex items-center justify-between">
                    <Icon className="h-5 w-5 text-emerald-300" />
                    <span className="rounded-full bg-white/[0.07] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                      {t("home.card.live")}
                    </span>
                  </div>
                  <div className="text-2xl font-semibold text-white">{value}</div>
                  <div className="mt-1 text-sm font-medium text-zinc-200">{t(titleKey)}</div>
                  <p className="mt-1 text-xs text-zinc-500">{t(labelKey)}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-lg border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("home.strategyEquity")}</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{t("home.allocationRun")}</h2>
                </div>
                <LineChart className="h-5 w-5 text-sky-300" />
              </div>
              <SignalLine />
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-zinc-500">{t("home.sharpe")}</p>
                  <p className="mt-1 font-semibold text-white">2.41</p>
                </div>
                <div>
                  <p className="text-zinc-500">{t("home.maxDd")}</p>
                  <p className="mt-1 font-semibold text-rose-200">-4.8%</p>
                </div>
                <div>
                  <p className="text-zinc-500">{t("home.winRate")}</p>
                  <p className="mt-1 font-semibold text-emerald-200">63%</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/25 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("home.signalFeed")}</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{t("home.latestEvents")}</h2>
                </div>
                <Activity className="h-5 w-5 text-orange-300" />
              </div>
              <div className="space-y-3">
                {eventRows.map((event) => (
                  <div key={`${event.time}-${event.tagKey}`} className="flex gap-3 rounded-md bg-black/25 p-3">
                    <span className="w-10 shrink-0 font-mono text-xs text-zinc-500">{event.time}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200">{t(event.textKey)}</p>
                      <p className="mt-1 text-xs text-emerald-300">{t(event.tagKey)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="relative mx-auto flex w-full max-w-[420px] items-center lg:mx-0">
          <div className="w-full rounded-[28px] border border-white/15 bg-[#0a0d0b]/90 p-3 shadow-[0_30px_100px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="rounded-[22px] border border-white/10 bg-[#07100d] p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-zinc-500">{t("home.terminal")}</p>
                  <h2 className="text-base font-semibold text-white">{t("home.autonomousResearch")}</h2>
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  {t("home.card.live")}
                </div>
              </div>

              <div className="rounded-lg border border-emerald-300/15 bg-gradient-to-br from-emerald-400/12 to-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-200/80">{t("home.portfolioNav")}</p>
                    <p className="mt-2 text-3xl font-semibold text-white">$428,650</p>
                    <p className="mt-1 text-sm text-emerald-300">{t("home.thisQuarter")}</p>
                  </div>
                  <CircleDollarSign className="h-8 w-8 text-orange-300" />
                </div>
                <div className="mt-4">
                  <MiniBars />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <Gauge className="mb-3 h-5 w-5 text-sky-300" />
                  <p className="text-xs text-zinc-500">{t("home.riskBudget")}</p>
                  <p className="mt-1 text-lg font-semibold text-white">62%</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                  <Radar className="mb-3 h-5 w-5 text-orange-300" />
                  <p className="text-xs text-zinc-500">{t("home.openScans")}</p>
                  <p className="mt-1 text-lg font-semibold text-white">148</p>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">{t("home.marketTape")}</p>
                  <CandlestickChart className="h-4 w-4 text-emerald-300" />
                </div>
                <div className="space-y-2">
                  {marketRows.map((row) => (
                    <div key={row.symbol} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md bg-black/20 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-zinc-100">{row.symbol}</p>
                        <p className="text-xs text-zinc-500">{t(row.biasKey)}</p>
                      </div>
                      <p className="font-mono text-sm text-zinc-300">{row.price}</p>
                      <p className={`font-mono text-sm font-semibold ${row.tone}`}>{row.change}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">{t("home.agentWatchlist")}</p>
                  <Bot className="h-4 w-4 text-sky-300" />
                </div>
                <div className="space-y-3">
                  {watchlist.map((item) => (
                    <div key={item.nameKey}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-zinc-300">{t(item.nameKey)}</span>
                        <span className="font-mono text-zinc-500">{item.score}/100</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.score}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <Link
                  to="/correlation"
                  className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.1]"
                >
                  <BarChart3 className="h-4 w-4" />
                  {t("home.matrix")}
                </Link>
                <Link
                  to="/agent"
                  className="flex items-center justify-center gap-2 rounded-lg bg-emerald-400 px-3 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300"
                >
                  <Zap className="h-4 w-4" />
                  {t("home.runAgent")}
                </Link>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
