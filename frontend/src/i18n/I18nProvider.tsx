import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  defaultLanguage,
  languages,
  translations,
  type LanguageCode,
  type TranslationKey,
  type TranslationValue,
} from "./translations";

const STORAGE_KEY = "vibe-language";

interface I18nContextValue {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  tArray: (key: TranslationKey) => string[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isLanguageCode(value: string | null): value is LanguageCode {
  return languages.some((language) => language.code === value);
}

function getInitialLanguage(): LanguageCode {
  if (typeof window === "undefined") return defaultLanguage;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (isLanguageCode(stored)) return stored;
  const browserLanguage = window.navigator.language;
  return browserLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

function format(value: string, params?: Record<string, string | number>): string {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, key) => {
    const next = params[key];
    return next === undefined ? match : String(next);
  });
}

function createTranslator(language: LanguageCode): Pick<I18nContextValue, "t" | "tArray"> {
  const dictionary = translations[language];
  const fallback = translations[defaultLanguage];
  const t = (key: TranslationKey, params?: Record<string, string | number>) => {
    const raw = dictionary[key] ?? fallback[key] ?? key;
    return format(Array.isArray(raw) ? raw.join(", ") : raw, params);
  };
  const tArray = (key: TranslationKey) => {
    const raw: TranslationValue = dictionary[key] ?? fallback[key] ?? key;
    return Array.isArray(raw) ? [...raw] : [raw];
  };
  return { t, tArray };
}

const fallbackContext: I18nContextValue = {
  language: defaultLanguage,
  setLanguage: () => {},
  toggleLanguage: () => {},
  ...createTranslator(defaultLanguage),
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(() => getInitialLanguage());

  const setLanguage = (nextLanguage: LanguageCode) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(STORAGE_KEY, nextLanguage);
  };

  const value = useMemo<I18nContextValue>(() => {
    const toggleLanguage = () => {
      setLanguage(language === "zh-CN" ? "en-US" : "zh-CN");
    };
    return { language, setLanguage, toggleLanguage, ...createTranslator(language) };
  }, [language]);

  useEffect(() => {
    document.documentElement.lang = language === "zh-CN" ? "zh-CN" : "en-US";
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const value = useContext(I18nContext);
  return value ?? fallbackContext;
}
