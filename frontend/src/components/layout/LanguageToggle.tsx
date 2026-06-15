import { Languages } from "lucide-react";
import { useTranslation } from "@/i18n/I18nProvider";
import { languages } from "@/i18n/translations";
import { cn } from "@/lib/utils";

interface Props {
  collapsed?: boolean;
}

export function LanguageToggle({ collapsed = false }: Props) {
  const { language, setLanguage, t } = useTranslation();

  if (collapsed) {
    const next = language === "zh-CN" ? "en-US" : "zh-CN";
    const nextLanguage = languages.find((item) => item.code === next)!;
    return (
      <button
        type="button"
        onClick={() => setLanguage(next)}
        className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
        title={`${t("app.language")}: ${nextLanguage.label}`}
        aria-label={t("app.language")}
      >
        <Languages className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Languages className="h-3.5 w-3.5" />
        {t("app.language")}
      </span>
      <div className="grid grid-cols-2 rounded-md border bg-muted/40 p-0.5">
        {languages.map((item) => (
          <button
            key={item.code}
            type="button"
            onClick={() => setLanguage(item.code)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
              language === item.code
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={language === item.code}
            title={item.label}
          >
            {item.shortLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
