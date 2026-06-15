import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@/i18n/I18nProvider";

interface Props { children: ReactNode; fallback?: ReactNode; }
interface State { hasError: boolean; error?: Error; }

function DefaultErrorFallback({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{message || t("chat.errorFallback")}</span>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <DefaultErrorFallback message={this.state.error?.message} />
      );
    }
    return this.props.children;
  }
}
