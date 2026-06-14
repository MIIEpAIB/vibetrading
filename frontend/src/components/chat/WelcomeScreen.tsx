import { Bot, TrendingUp, Globe, Sparkles, Users, UserCircle2, NotebookPen, Landmark, ShieldCheck, Zap } from "lucide-react";

interface Example {
  title: string;
  desc: string;
  prompt: string;
}

interface Category {
  label: string;
  icon: React.ReactNode;
  color: string;
  examples: Example[];
}

const CATEGORIES: Category[] = [
  {
    label: "Multi-Market Backtest",
    icon: <TrendingUp className="h-4 w-4" />,
    color: "text-emerald-300 border-emerald-300/20 hover:border-emerald-300/45 hover:bg-emerald-300/10",
    examples: [
      {
        title: "Cross-Market Portfolio",
        desc: "A-shares + crypto + US equities with risk-parity optimizer",
        prompt: "Backtest a risk-parity portfolio of 000001.SZ, BTC-USDT, and AAPL for full-year 2024, compare against equal-weight baseline",
      },
      {
        title: "BTC 5-Min MACD Strategy",
        desc: "Minute-level crypto backtest with real-time OKX data",
        prompt: "Backtest BTC-USDT 5-minute MACD strategy, fast=12 slow=26 signal=9, last 30 days",
      },
      {
        title: "US Tech Max Diversification",
        desc: "Portfolio optimizer across FAANG+ via yfinance",
        prompt: "Backtest AAPL, MSFT, GOOGL, AMZN, NVDA with max_diversification portfolio optimizer, full-year 2024",
      },
    ],
  },
  {
    label: "Research & Analysis",
    icon: <Sparkles className="h-4 w-4" />,
    color: "text-orange-300 border-orange-300/20 hover:border-orange-300/45 hover:bg-orange-300/10",
    examples: [
      {
        title: "Multi-Factor Alpha Model",
        desc: "IC-weighted factor synthesis across 300 stocks",
        prompt: "Build a multi-factor alpha model using momentum, reversal, volatility, and turnover on CSI 300 constituents with IC-weighted factor synthesis, backtest 2023-2024",
      },
      {
        title: "Options Greeks Analysis",
        desc: "Black-Scholes pricing with Delta/Gamma/Theta/Vega",
        prompt: "Calculate option Greeks using Black-Scholes: spot=100, strike=105, risk-free rate=3%, vol=25%, expiry=90 days, analyze Delta/Gamma/Theta/Vega",
      },
    ],
  },
  {
    label: "Swarm Teams",
    icon: <Users className="h-4 w-4" />,
    color: "text-sky-300 border-sky-300/20 hover:border-sky-300/45 hover:bg-sky-300/10",
    examples: [
      {
        title: "Investment Committee Review",
        desc: "Multi-agent debate: long vs short, risk review, PM decision",
        prompt: "[Swarm Team Mode] Use the investment_committee preset to evaluate whether to go long or short on NVDA given current market conditions",
      },
      {
        title: "Quant Strategy Desk",
        desc: "Screening → factor research → backtest → risk audit pipeline",
        prompt: "[Swarm Team Mode] Use the quant_strategy_desk preset to find and backtest the best momentum strategy on CSI 300 constituents",
      },
    ],
  },
  {
    label: "Document & Web Research",
    icon: <Globe className="h-4 w-4" />,
    color: "text-sky-300 border-sky-300/20 hover:border-sky-300/45 hover:bg-sky-300/10",
    examples: [
      {
        title: "Analyze an Earnings Report PDF",
        desc: "Upload a PDF and ask questions about the financials",
        prompt: "Summarize the key financial metrics, risks, and outlook from the uploaded earnings report",
      },
      {
        title: "Web Research: Macro Outlook",
        desc: "Read live web sources for macro analysis",
        prompt: "Read the latest Fed meeting minutes and summarize the key takeaways for equity and crypto markets",
      },
    ],
  },
  {
    label: "Trade Journal",
    icon: <NotebookPen className="h-4 w-4" />,
    color: "text-orange-300 border-orange-300/20 hover:border-orange-300/45 hover:bg-orange-300/10",
    examples: [
      {
        title: "Analyze My Broker Export",
        desc: "Parse 同花顺/东财/富途/generic CSV — holding days, win rate, PnL ratio, hourly distribution",
        prompt: "Analyze the trade journal I just uploaded — full profile with holding stats, win rate, top symbols, and hourly distribution",
      },
      {
        title: "Diagnose My Behavior Biases",
        desc: "Disposition effect, overtrading, chasing momentum, anchoring — severity + numeric evidence",
        prompt: "Run the 4 behavior diagnostics on my trade journal (disposition, overtrading, chasing, anchoring) and tell me which bias hurts my PnL most",
      },
    ],
  },
  {
    label: "Trading Connectors",
    icon: <Landmark className="h-4 w-4" />,
    color: "text-emerald-300 border-emerald-300/20 hover:border-emerald-300/45 hover:bg-emerald-300/10",
    examples: [
      {
        title: "Check Selected Connector",
        desc: "List connector profiles and verify the selected one",
        prompt: "List my trading connector profiles, show which one is selected, then check that selected connector. If it is not ready, tell me exactly what setup step is missing. Do not place or modify orders.",
      },
      {
        title: "Analyze Connector Portfolio",
        desc: "Read account summary and positions from the selected connector",
        prompt: "Use the selected trading connector profile to summarize my account, positions, concentration, cash, and portfolio risk. Do not place or modify orders.",
      },
      {
        title: "Quote & Trend",
        desc: "Fetch a quote plus recent daily bars through the selected connector",
        prompt: "Use the selected trading connector to fetch an AAPL quote and 30 daily bars, then summarize the current quote versus the recent trend. Keep it read-only.",
      },
    ],
  },
  {
    label: "Shadow Account",
    icon: <UserCircle2 className="h-4 w-4" />,
    color: "text-emerald-300 border-emerald-300/20 hover:border-emerald-300/45 hover:bg-emerald-300/10",
    examples: [
      {
        title: "Train My Shadow from Journal",
        desc: "Extract your strategy rules from a broker CSV and persist a Shadow profile",
        prompt: "Train my shadow account from the trading journal I just uploaded — show the extracted rules and confirm they look like my behavior",
      },
      {
        title: "How Much Am I Leaving on the Table?",
        desc: "Backtest your shadow strategy and attribute delta vs. your actual PnL",
        prompt: "Run a shadow backtest for the last 90 days on the US market and break down where my PnL diverged from the shadow (rule violations, early exits, missed signals)",
      },
      {
        title: "Generate Shadow Report",
        desc: "8-section HTML/PDF — equity curve, per-market Sharpe, attribution waterfall",
        prompt: "Render the shadow report and give me the URL — lead with the you-vs-shadow delta",
      },
    ],
  },
];

const CAPABILITY_CHIPS = [
  "Finance Skills Library",
  "Rui Swarm Teams",
  "Auto-Discovered Tools",
  "3 Markets: A-Share · Crypto · HK/US",
  "Trading Connector Profiles",
  "Minute to Daily Timeframes",
  "4 Portfolio Optimizers",
  "15+ Risk Metrics",
  "Options & Derivatives",
  "PDF & Web Research",
  "Factor Analysis & ML",
  "Trade Journal Analyzer",
  "Shadow Account Backtest",
  "Persistent Memory",
  "Session Search",
];

interface Props {
  onExample: (s: string) => void;
}

export function WelcomeScreen({ onExample }: Props) {
  return (
    <div className="flex min-h-[60vh] flex-col justify-center space-y-7 text-left">
      {/* Header */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-300/20 bg-emerald-300/10 shadow-lg shadow-black/25">
              <Bot className="h-6 w-6 text-emerald-200" />
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-300/20 bg-orange-400/10 px-3 py-1.5 text-xs font-semibold text-orange-200">
              <Zap className="h-3.5 w-3.5" />
              Rui powered by DeepSeek
            </div>
          </div>
          <div>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              Ask Rui to research, test, and explain.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
              Start with a symbol, portfolio, document, or strategy idea. The agent can call tools, run swarms, backtest, and keep a research goal ledger.
            </p>
          </div>
        </div>
        <div className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Provider</span>
            <span className="font-semibold text-emerald-200">DeepSeek</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Mode</span>
            <span className="font-semibold text-white">Research</span>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-200">
            <ShieldCheck className="h-4 w-4" />
            Read-only until connector mandates are explicitly approved.
          </div>
        </div>
      </div>

      {/* Capability chips */}
      <div className="flex max-w-4xl flex-wrap gap-2">
        {CAPABILITY_CHIPS.map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-xs text-zinc-400"
          >
            {chip}
          </span>
        ))}
      </div>

      {/* Example categories grid */}
      <div className="w-full space-y-4">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Try an example</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.label} className="space-y-2">
              <div className={`flex items-center gap-1.5 text-xs font-medium px-1 ${cat.color.split(" ").filter(c => c.startsWith("text-")).join(" ")}`}>
                {cat.icon}
                <span>{cat.label}</span>
              </div>
              <div className="space-y-1.5">
                {cat.examples.map((ex) => (
                  <button
                    key={ex.title}
                    onClick={() => onExample(ex.prompt)}
                    className={`block w-full rounded-lg border bg-white/[0.035] px-3 py-2.5 text-left transition-colors ${cat.color}`}
                  >
                    <span className="text-sm font-semibold leading-snug text-zinc-100">
                      {ex.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-zinc-500">
                      {ex.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
