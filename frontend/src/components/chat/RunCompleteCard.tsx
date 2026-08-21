import { memo, useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarChart3, BookmarkPlus, Code2, FileText, Loader2, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { api, type RunData, type StrategyLibraryItem } from "@/lib/api";
import { AgentAvatar } from "./AgentAvatar";
import { MetricsCard } from "./MetricsCard";
import { MiniEquityChart } from "@/components/charts/MiniEquityChart";
import { PineScriptViewer } from "./PineScriptViewer";
import type { AgentMessage } from "@/types/agent";
import { useTranslation } from "@/i18n/I18nProvider";

interface Props {
  msg: AgentMessage;
}

function strategySlug(value: string): string {
  return (value || "agent-run-strategy")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "agent-run-strategy";
}

function strategyName(runId: string, runData: RunData | null): string {
  const prompt = runData?.prompt?.trim();
  if (!prompt) return `Agent run ${runId.slice(0, 8)}`;
  return prompt.split(/\n+/)[0].replace(/\s+/g, " ").slice(0, 80);
}

function strategyNotes(runId: string, runData: RunData | null): string {
  const lines = [
    runData?.prompt?.trim() || "",
    "",
    "Source: agent backtest report imported by explicit user action.",
    `Run: ${runId}`,
  ];
  if (runData?.status) lines.push(`Status: ${runData.status}`);
  if (runData?.run_stage) lines.push(`Stage: ${runData.run_stage}`);
  return lines.filter((line, index) => index === 1 || line.trim()).join("\n").trim();
}

function buildStrategyFromRun(runId: string, runData: RunData | null, code: string): StrategyLibraryItem {
  const now = new Date().toISOString();
  const name = strategyName(runId, runData);
  return {
    id: `${strategySlug(name)}-${runId.slice(0, 8)}`,
    name,
    description: "Imported from an agent backtest report.",
    strategyDescription: strategyNotes(runId, runData),
    language: "python",
    category: "trend",
    status: "draft",
    tags: ["agent", "backtest"],
    code,
    createdAt: now,
    updatedAt: now,
    shareStatus: "none",
  };
}

export const RunCompleteCard = memo(function RunCompleteCard({ msg }: Props) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [curve, setCurve] = useState(msg.equityCurve);
  const [pineCode, setPineCode] = useState<string | null>(null);
  const [pineLoading, setPineLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [libraryImportLoading, setLibraryImportLoading] = useState(false);
  const [libraryImportedId, setLibraryImportedId] = useState<string | null>(null);
  const [showPine, setShowPine] = useState(false);
  const [pineChecked, setPineChecked] = useState(false);
  const [pineExists, setPineExists] = useState(false);

  useEffect(() => {
    if (!curve && msg.runId) {
      api.getRun(msg.runId).then(r => {
        if (r.equity_curve) setCurve(r.equity_curve.map(e => ({ time: e.time, equity: e.equity })));
      }).catch(() => {});
    }
  }, [msg.runId, curve]);

  // Check if Pine Script exists for this run (skip for shadow-only cards with no runId)
  useEffect(() => {
    if (!msg.runId) {
      setPineChecked(true);
      return;
    }
    if (!pineChecked) {
      api.getRunPine(msg.runId).then(r => {
        setPineChecked(true);
        if (r.exists && r.content) {
          setPineExists(true);
          setPineCode(r.content);
        }
      }).catch(() => { setPineChecked(true); });
    }
  }, [msg.runId, pineChecked]);

  const handlePineClick = useCallback(async () => {
    if (pineCode) {
      setShowPine(true);
      return;
    }
    if (!msg.runId) return;
    setPineLoading(true);
    try {
      const r = await api.getRunPine(msg.runId);
      if (r.exists && r.content) {
        setPineCode(r.content);
        setPineExists(true);
        setShowPine(true);
      }
    } catch { /* ignore */ }
    finally { setPineLoading(false); }
  }, [pineCode, msg.runId]);

  const handleOpenShadowDeployments = useCallback(async () => {
    if (!msg.runId && !msg.shadowId) return;
    setImportLoading(true);
    try {
      navigate("/deployments?target=SHADOW");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("chat.shadowDeploymentOpenFailed"));
    } finally {
      setImportLoading(false);
    }
  }, [msg.runId, msg.shadowId, navigate, t]);

  const handleLibraryImport = useCallback(async () => {
    if (!msg.runId || libraryImportLoading) return;
    setLibraryImportLoading(true);
    try {
      const [runData, codeFiles] = await Promise.all([
        api.getRun(msg.runId).catch(() => null),
        api.getRunCode(msg.runId),
      ]);
      const code = codeFiles["signal_engine.py"] || Object.values(codeFiles)[0] || "";
      if (!code.trim()) {
        toast.error(language === "zh-CN" ? "这个报告没有可导入的策略代码" : "This report has no importable strategy code");
        return;
      }
      const strategy = buildStrategyFromRun(msg.runId, runData, code);
      const saved = await api.upsertStrategy(strategy);
      setLibraryImportedId(saved.id);
      toast.success(language === "zh-CN" ? `已导入策略库：${saved.name}` : `Imported to strategy library: ${saved.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "导入策略库失败" : "Failed to import to strategy library");
    } finally {
      setLibraryImportLoading(false);
    }
  }, [language, libraryImportLoading, msg.runId]);

  return (
    <div className="flex gap-3">
      <AgentAvatar />
      <div className="flex-1 min-w-0 space-y-2">
        {msg.metrics && Object.keys(msg.metrics).length > 0 && (
          <MetricsCard metrics={msg.metrics} compact />
        )}
        {curve && curve.length > 1 && (
          <MiniEquityChart data={curve} height={80} />
        )}
        <div className="flex items-center gap-3 flex-wrap">
          {msg.runId && (
            <Link
              to={`/runs/${msg.runId}`}
              className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 font-medium"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              {t("chat.fullReport")} →
            </Link>
          )}
          {msg.runId && (
            <button
              type="button"
              onClick={handleLibraryImport}
              disabled={libraryImportLoading || Boolean(libraryImportedId)}
              className="text-sm text-orange-600 dark:text-orange-400 hover:underline inline-flex items-center gap-1.5 font-medium disabled:opacity-50"
              title={language === "zh-CN" ? "导入到我的策略库" : "Import to my strategy library"}
            >
              {libraryImportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
              {libraryImportedId ? (language === "zh-CN" ? "已导入策略库" : "Imported to Library") : (language === "zh-CN" ? "导入策略库" : "Import to Library")}
            </button>
          )}
          {pineExists && (
            <button
              onClick={handlePineClick}
              disabled={pineLoading}
              className="text-sm text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1.5 font-medium disabled:opacity-50"
            >
              {pineLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code2 className="h-3.5 w-3.5" />}
              {t("chat.pineScript")}
            </button>
          )}
          {(msg.runId || msg.shadowId) && (
            <button
              type="button"
              onClick={handleOpenShadowDeployments}
              disabled={importLoading}
              className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline inline-flex items-center gap-1.5 font-medium disabled:opacity-50"
              title={t("chat.shadowDeploymentTitle")}
            >
              {importLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WalletCards className="h-3.5 w-3.5" />}
              {t("chat.openShadowDeployments")}
            </button>
          )}
          {msg.shadowId && (
            <a
              href={`/shadow-reports/${encodeURIComponent(msg.shadowId)}?format=html`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-1.5 font-medium"
            >
              <FileText className="h-3.5 w-3.5" />
              {t("chat.shadowReport")}
            </a>
          )}
        </div>
        {showPine && pineCode && (
          <PineScriptViewer code={pineCode} onClose={() => setShowPine(false)} />
        )}
      </div>
    </div>
  );
});
