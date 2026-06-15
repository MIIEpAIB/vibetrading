import { Bot, TrendingUp, Globe, Sparkles, Users, UserCircle2, NotebookPen, Landmark, ShieldCheck, Zap } from "lucide-react";
import { useTranslation } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/translations";

interface Example {
  titleKey: TranslationKey;
  descKey: TranslationKey;
  promptKey: TranslationKey;
}

interface Category {
  labelKey: TranslationKey;
  icon: React.ReactNode;
  color: string;
  examples: Example[];
}

const CATEGORIES: Category[] = [
  {
    labelKey: "welcome.cat.multiMarket",
    icon: <TrendingUp className="h-4 w-4" />,
    color: "text-emerald-300 border-emerald-300/20 hover:border-emerald-300/45 hover:bg-emerald-300/10",
    examples: [
      {
        titleKey: "welcome.example.crossMarket.title",
        descKey: "welcome.example.crossMarket.desc",
        promptKey: "welcome.example.crossMarket.prompt",
      },
      {
        titleKey: "welcome.example.btc.title",
        descKey: "welcome.example.btc.desc",
        promptKey: "welcome.example.btc.prompt",
      },
      {
        titleKey: "welcome.example.usTech.title",
        descKey: "welcome.example.usTech.desc",
        promptKey: "welcome.example.usTech.prompt",
      },
    ],
  },
  {
    labelKey: "welcome.cat.research",
    icon: <Sparkles className="h-4 w-4" />,
    color: "text-orange-300 border-orange-300/20 hover:border-orange-300/45 hover:bg-orange-300/10",
    examples: [
      {
        titleKey: "welcome.example.factor.title",
        descKey: "welcome.example.factor.desc",
        promptKey: "welcome.example.factor.prompt",
      },
      {
        titleKey: "welcome.example.options.title",
        descKey: "welcome.example.options.desc",
        promptKey: "welcome.example.options.prompt",
      },
    ],
  },
  {
    labelKey: "welcome.cat.swarm",
    icon: <Users className="h-4 w-4" />,
    color: "text-sky-300 border-sky-300/20 hover:border-sky-300/45 hover:bg-sky-300/10",
    examples: [
      {
        titleKey: "welcome.example.committee.title",
        descKey: "welcome.example.committee.desc",
        promptKey: "welcome.example.committee.prompt",
      },
      {
        titleKey: "welcome.example.quantDesk.title",
        descKey: "welcome.example.quantDesk.desc",
        promptKey: "welcome.example.quantDesk.prompt",
      },
    ],
  },
  {
    labelKey: "welcome.cat.docs",
    icon: <Globe className="h-4 w-4" />,
    color: "text-sky-300 border-sky-300/20 hover:border-sky-300/45 hover:bg-sky-300/10",
    examples: [
      {
        titleKey: "welcome.example.pdf.title",
        descKey: "welcome.example.pdf.desc",
        promptKey: "welcome.example.pdf.prompt",
      },
      {
        titleKey: "welcome.example.macro.title",
        descKey: "welcome.example.macro.desc",
        promptKey: "welcome.example.macro.prompt",
      },
    ],
  },
  {
    labelKey: "welcome.cat.journal",
    icon: <NotebookPen className="h-4 w-4" />,
    color: "text-orange-300 border-orange-300/20 hover:border-orange-300/45 hover:bg-orange-300/10",
    examples: [
      {
        titleKey: "welcome.example.journal.title",
        descKey: "welcome.example.journal.desc",
        promptKey: "welcome.example.journal.prompt",
      },
      {
        titleKey: "welcome.example.bias.title",
        descKey: "welcome.example.bias.desc",
        promptKey: "welcome.example.bias.prompt",
      },
    ],
  },
  {
    labelKey: "welcome.cat.connectors",
    icon: <Landmark className="h-4 w-4" />,
    color: "text-emerald-300 border-emerald-300/20 hover:border-emerald-300/45 hover:bg-emerald-300/10",
    examples: [
      {
        titleKey: "welcome.example.checkConnector.title",
        descKey: "welcome.example.checkConnector.desc",
        promptKey: "welcome.example.checkConnector.prompt",
      },
      {
        titleKey: "welcome.example.portfolio.title",
        descKey: "welcome.example.portfolio.desc",
        promptKey: "welcome.example.portfolio.prompt",
      },
      {
        titleKey: "welcome.example.quote.title",
        descKey: "welcome.example.quote.desc",
        promptKey: "welcome.example.quote.prompt",
      },
    ],
  },
  {
    labelKey: "welcome.cat.shadow",
    icon: <UserCircle2 className="h-4 w-4" />,
    color: "text-emerald-300 border-emerald-300/20 hover:border-emerald-300/45 hover:bg-emerald-300/10",
    examples: [
      {
        titleKey: "welcome.example.trainShadow.title",
        descKey: "welcome.example.trainShadow.desc",
        promptKey: "welcome.example.trainShadow.prompt",
      },
      {
        titleKey: "welcome.example.shadowDelta.title",
        descKey: "welcome.example.shadowDelta.desc",
        promptKey: "welcome.example.shadowDelta.prompt",
      },
      {
        titleKey: "welcome.example.shadowReport.title",
        descKey: "welcome.example.shadowReport.desc",
        promptKey: "welcome.example.shadowReport.prompt",
      },
    ],
  },
];

interface Props {
  onExample: (s: string) => void;
}

export function WelcomeScreen({ onExample }: Props) {
  const { t, tArray } = useTranslation();

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
              {t("welcome.badge")}
            </div>
          </div>
          <div>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              {t("welcome.title")}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
              {t("welcome.subtitle")}
            </p>
          </div>
        </div>
        <div className="grid gap-2 rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/20">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">{t("welcome.provider")}</span>
            <span className="font-semibold text-emerald-200">DeepSeek</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">{t("welcome.mode")}</span>
            <span className="font-semibold text-white">{t("welcome.modeResearch")}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-200">
            <ShieldCheck className="h-4 w-4" />
            {t("welcome.readOnly")}
          </div>
        </div>
      </div>

      {/* Capability chips */}
      <div className="flex max-w-4xl flex-wrap gap-2">
        {tArray("welcome.chips").map((chip) => (
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
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("welcome.tryExample")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.labelKey} className="space-y-2">
              <div className={`flex items-center gap-1.5 text-xs font-medium px-1 ${cat.color.split(" ").filter(c => c.startsWith("text-")).join(" ")}`}>
                {cat.icon}
                <span>{t(cat.labelKey)}</span>
              </div>
              <div className="space-y-1.5">
                {cat.examples.map((ex) => (
                  <button
                    key={ex.titleKey}
                    onClick={() => onExample(t(ex.promptKey))}
                    className={`block w-full rounded-lg border bg-white/[0.035] px-3 py-2.5 text-left transition-colors ${cat.color}`}
                  >
                    <span className="text-sm font-semibold leading-snug text-zinc-100">
                      {t(ex.titleKey)}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-zinc-500">
                      {t(ex.descKey)}
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
