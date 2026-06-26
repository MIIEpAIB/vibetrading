import { memo, useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarChart3, Code2, FileText, Loader2, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { buildShadowImportDraft, saveShadowImportDraft } from "@/lib/shadowImport";
import { AgentAvatar } from "./AgentAvatar";
import { MetricsCard } from "./MetricsCard";
import { MiniEquityChart } from "@/components/charts/MiniEquityChart";
import { PineScriptViewer } from "./PineScriptViewer";
import type { AgentMessage } from "@/types/agent";
import { useTranslation } from "@/i18n/I18nProvider";

interface Props {
  msg: AgentMessage;
}

export const RunCompleteCard = memo(function RunCompleteCard({ msg }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [curve, setCurve] = useState(msg.equityCurve);
  const [pineCode, setPineCode] = useState<string | null>(null);
  const [pineLoading, setPineLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
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

  const handleShadowImport = useCallback(async () => {
    if (!msg.runId && !msg.shadowId) return;
    setImportLoading(true);
    try {
      const runData = msg.runId ? await api.getRun(msg.runId).catch(() => null) : null;
      const draft = buildShadowImportDraft({
        runId: msg.runId,
        shadowId: msg.shadowId,
        metrics: msg.metrics,
        runData,
      });
      const key = saveShadowImportDraft(draft);
      navigate(`/shadow-trading?import=${encodeURIComponent(key)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("chat.shadowImportFailed"));
    } finally {
      setImportLoading(false);
    }
  }, [msg.metrics, msg.runId, msg.shadowId, navigate, t]);

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
              onClick={handleShadowImport}
              disabled={importLoading}
              className="text-sm text-cyan-600 dark:text-cyan-400 hover:underline inline-flex items-center gap-1.5 font-medium disabled:opacity-50"
              title={t("chat.shadowImportTitle")}
            >
              {importLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WalletCards className="h-3.5 w-3.5" />}
              {t("chat.importToShadow")}
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
