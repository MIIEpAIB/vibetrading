import { memo, useState, useCallback } from "react";
import { User, XCircle, RefreshCw, Copy, Check, BookmarkPlus, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatTimestamp } from "@/lib/formatters";
import type { AgentMessage } from "@/types/agent";
import { AgentAvatar } from "./AgentAvatar";
import { RunCompleteCard } from "./RunCompleteCard";
import { useTranslation } from "@/i18n/I18nProvider";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded-md border border-white/10 bg-black/30 p-1.5 text-zinc-500 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-white group-hover:opacity-100"
      title={copied ? t("chat.copied") : t("chat.copy")}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function getRetryHint(content: string, t: Translate): string {
  const lower = content.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return t("chat.retry.timeout");
  }
  if (lower.includes("api") || lower.includes("rate limit") || lower.includes("429") || lower.includes("500") || lower.includes("502") || lower.includes("503")) {
    return t("chat.retry.api");
  }
  return t("chat.retry.generic");
}

interface Props {
  msg: AgentMessage;
  onRetry?: (msg: AgentMessage) => void;
  sessionId?: string | null;
}

interface StrategyCandidate {
  name: string;
  description: string;
  strategyDescription: string;
  language: "python" | "javascript";
  category: string;
  tags: string[];
  code: string;
}

function inferStrategyName(content: string): string {
  const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 80);
  const named = content.match(/(?:strategy|策略)[:：]\s*([^\n]+)/i)?.[1]?.trim();
  if (named) return named.slice(0, 80);
  return "Agent Strategy";
}

function extractStrategyCandidate(content: string): StrategyCandidate | null {
  const fencePattern = /```(\w+)?\s*\n([\s\S]*?)```/g;
  const fences = [...content.matchAll(fencePattern)];
  for (const fence of fences) {
    const language = (fence[1] || "").trim().toLowerCase();
    const code = (fence[2] || "").trim();
    if (!code) continue;
    if (language === "python" || language === "py" || (!language && code.includes("class SignalEngine"))) {
      if (!code.includes("class SignalEngine") && !/\bdef\s+generate_signals\s*\(/.test(code)) continue;
      return {
        name: inferStrategyName(content),
        description: "Agent-generated strategy candidate.",
        strategyDescription: content.replace(fence[0], "").trim().slice(0, 10000),
        language: "python",
        category: "trend",
        tags: ["agent"],
        code,
      };
    }
  }
  return null;
}

export const MessageBubble = memo(function MessageBubble({ msg, onRetry, sessionId }: Props) {
  const { t, language } = useTranslation();
  const ts = msg.timestamp ? formatTimestamp(msg.timestamp) : null;
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [savedStrategyId, setSavedStrategyId] = useState<string | null>(null);
  const strategyCandidate = msg.type === "answer" ? extractStrategyCandidate(msg.content) : null;
  const saveLabel = language === "zh-CN" ? "保存到个人策略" : "Save to Strategies";
  const savedLabel = language === "zh-CN" ? "已保存" : "Saved";

  const saveStrategy = useCallback(async () => {
    if (!sessionId || !strategyCandidate) return;
    setSavingStrategy(true);
    try {
      const saved = await api.saveSessionStrategy(sessionId, {
        ...strategyCandidate,
        message_id: msg.id,
      });
      setSavedStrategyId(saved.id);
      toast.success(language === "zh-CN" ? `已保存策略：${saved.name}` : `Saved strategy: ${saved.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : language === "zh-CN" ? "保存策略失败" : "Failed to save strategy");
    } finally {
      setSavingStrategy(false);
    }
  }, [language, msg.id, sessionId, strategyCandidate]);

  if (msg.type === "user") {
    return (
      <div className="flex justify-end gap-3 group">
        <div className="max-w-[78%] rounded-lg rounded-tr-sm bg-orange-500 px-4 py-2.5 text-sm leading-relaxed text-white shadow-lg shadow-orange-500/15 whitespace-pre-wrap">
          {msg.content}
          {ts && <span className="block text-[9px] opacity-50 text-right mt-1">{ts}</span>}
        </div>
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06]">
          <User className="h-4 w-4 text-zinc-400" />
        </div>
      </div>
    );
  }

  if (msg.type === "answer") {
    return (
      <div className="flex gap-3 group">
        <AgentAvatar />
        <div className="relative min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3 shadow-2xl shadow-black/10">
          <CopyButton text={msg.content} />
          <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed prose-p:text-zinc-200 prose-li:text-zinc-200 prose-strong:text-white prose-a:text-orange-300 prose-code:text-emerald-200 prose-pre:border prose-pre:border-white/10 prose-pre:bg-black/35 prose-table:border prose-table:border-white/10 prose-th:border-white/10 prose-th:bg-white/[0.06] prose-th:px-3 prose-th:py-1.5 prose-th:text-left prose-th:text-xs prose-th:font-medium prose-td:border-white/10 prose-td:px-3 prose-td:py-1.5 prose-td:text-xs prose-hr:hidden">
            <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{msg.content}</ReactMarkdown>
          </div>
          {strategyCandidate && sessionId && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={saveStrategy}
                disabled={savingStrategy || Boolean(savedStrategyId)}
                className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingStrategy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                {savedStrategyId ? savedLabel : saveLabel}
              </button>
            </div>
          )}
          {ts && <span className="mt-1 text-[9px] text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100">{ts}</span>}
        </div>
      </div>
    );
  }

  if (msg.type === "run_complete" && (msg.runId || msg.shadowId)) {
    return <RunCompleteCard msg={msg} />;
  }

  if (msg.type === "error") {
    const hint = getRetryHint(msg.content, t);
    return (
      <div className="flex gap-3">
        <AgentAvatar />
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-3">
            <XCircle className="h-4 w-4 text-rose-300 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-200 leading-relaxed">{msg.content}</p>
          </div>
          {onRetry && (
            <button
              onClick={() => onRetry(msg)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition-all hover:bg-white/[0.06] hover:text-white"
              title={hint}
            >
              <RefreshCw className="h-3 w-3" />
              <span>{hint}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // Fallback: show content for any unhandled message type
  if (msg.content) {
    return (
      <div className="flex gap-3">
        <AgentAvatar />
        <p className="text-sm text-zinc-400 leading-relaxed">{msg.content}</p>
      </div>
    );
  }

  return null;
});
