import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import {
  BookOpen,
  Code2,
  Compass,
  FileText,
  LogIn,
  MessageSquare,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/translations";

type PublicPageId = "market" | "library" | "community" | "api-docs";

interface PublicPageConfig {
  id: PublicPageId;
  path: string;
  titleKey: TranslationKey;
  subtitleKey: TranslationKey;
  icon: LucideIcon;
  actionKey: TranslationKey;
  actionHref: string;
  actionExternal?: boolean;
  highlights: Array<{ titleKey: TranslationKey; descKey: TranslationKey; metaKey: TranslationKey; href: string; external?: boolean; icon: LucideIcon }>;
}

const PUBLIC_PAGES: PublicPageConfig[] = [
  {
    id: "market",
    path: "/market",
    titleKey: "public.market.title",
    subtitleKey: "public.market.subtitle",
    actionKey: "public.market.action",
    actionHref: "/market",
    icon: ShoppingBag,
    highlights: [
      { titleKey: "public.market.item1.title", descKey: "public.market.item1.desc", metaKey: "public.market.item1.meta", href: "/market", icon: TrendingUp },
      { titleKey: "public.market.item2.title", descKey: "public.market.item2.desc", metaKey: "public.market.item2.meta", href: "/market", icon: Compass },
      { titleKey: "public.market.item3.title", descKey: "public.market.item3.desc", metaKey: "public.market.item3.meta", href: "/market", icon: Sparkles },
    ],
  },
  {
    id: "library",
    path: "/library",
    titleKey: "public.library.title",
    subtitleKey: "public.library.subtitle",
    actionKey: "public.library.action",
    actionHref: "https://vibetrading.wiki/docs/",
    actionExternal: true,
    icon: BookOpen,
    highlights: [
      { titleKey: "public.library.item1.title", descKey: "public.library.item1.desc", metaKey: "public.library.item1.meta", href: "https://vibetrading.wiki/docs/", external: true, icon: FileText },
      { titleKey: "public.library.item2.title", descKey: "public.library.item2.desc", metaKey: "public.library.item2.meta", href: "https://vibetrading.wiki/tutorials/", external: true, icon: BookOpen },
      { titleKey: "public.library.item3.title", descKey: "public.library.item3.desc", metaKey: "public.library.item3.meta", href: "https://vibetrading.wiki/alpha-library/", external: true, icon: Sparkles },
    ],
  },
  {
    id: "community",
    path: "/community",
    titleKey: "public.community.title",
    subtitleKey: "public.community.subtitle",
    actionKey: "public.community.action",
    actionHref: "/community",
    icon: Users,
    highlights: [
      { titleKey: "public.community.item1.title", descKey: "public.community.item1.desc", metaKey: "public.community.item1.meta", href: "/community", icon: MessageSquare },
      { titleKey: "public.community.item2.title", descKey: "public.community.item2.desc", metaKey: "public.community.item2.meta", href: "/community", icon: FileText },
      { titleKey: "public.community.item3.title", descKey: "public.community.item3.desc", metaKey: "public.community.item3.meta", href: "/messages", icon: Code2 },
    ],
  },
  {
    id: "api-docs",
    path: "/api-docs",
    titleKey: "public.apiDocs.title",
    subtitleKey: "public.apiDocs.subtitle",
    actionKey: "public.apiDocs.action",
    actionHref: "/docs",
    actionExternal: true,
    icon: Code2,
    highlights: [
      { titleKey: "public.apiDocs.item1.title", descKey: "public.apiDocs.item1.desc", metaKey: "public.apiDocs.item1.meta", href: "/docs", external: true, icon: Code2 },
      { titleKey: "public.apiDocs.item2.title", descKey: "public.apiDocs.item2.desc", metaKey: "public.apiDocs.item2.meta", href: "/docs", external: true, icon: Compass },
      { titleKey: "public.apiDocs.item3.title", descKey: "public.apiDocs.item3.desc", metaKey: "public.apiDocs.item3.meta", href: "/docs", external: true, icon: Sparkles },
    ],
  },
];

function getPublicPage(id?: string): PublicPageConfig {
  return PUBLIC_PAGES.find((page) => page.id === id) ?? PUBLIC_PAGES[0];
}

export function PublicLayout() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-normal">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span>Venus</span>
          </Link>
          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-1 md:flex">
            {PUBLIC_PAGES.map((page) => (
              <NavLink
                key={page.id}
                to={page.path}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition",
                    isActive || (pathname === "/" && page.id === "market")
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                }
              >
                {t(page.titleKey)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block">
              <LanguageToggle />
            </div>
            <div className="sm:hidden">
              <LanguageToggle collapsed />
            </div>
            <Link
              to={user ? "/dashboard" : "/login"}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              <LogIn className="h-4 w-4" />
              {user ? t("public.workbench") : t("auth.signIn")}
            </Link>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t px-4 py-2 md:hidden">
          {PUBLIC_PAGES.map((page) => (
            <NavLink
              key={page.id}
              to={page.path}
              className={({ isActive }) =>
                cn(
                  "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition",
                  isActive || (pathname === "/" && page.id === "market")
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              {t(page.titleKey)}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

export function PublicPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { pageId } = useParams();
  const { pathname } = useLocation();
  const pathPage = PUBLIC_PAGES.find((item) => item.path === pathname);
  const page = pathPage ?? getPublicPage(pageId);
  const Icon = page.icon;

  return (
    <main>
      <section className="border-b bg-card">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Icon className="h-3.5 w-3.5 text-primary" />
              {t("public.badge")}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-normal sm:text-4xl">{t(page.titleKey)}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{t(page.subtitleKey)}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                to={user ? "/dashboard" : "/login"}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                <LogIn className="h-4 w-4" />
                {user ? t("public.workbench") : t("public.login")}
              </Link>
              {page.actionExternal ? (
                <a href={page.actionHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  <BookOpen className="h-4 w-4" />
                  {t(page.actionKey)}
                </a>
              ) : (
                <Link to={page.actionHref} className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  <BookOpen className="h-4 w-4" />
                  {t(page.actionKey)}
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:px-6 lg:grid-cols-3 lg:px-8">
        {page.highlights.map((item) => {
          const ItemIcon = item.icon;
          return (
            <article key={item.titleKey} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <ItemIcon className="h-4 w-4" />
                </div>
                <span className="rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {t(item.metaKey)}
                </span>
              </div>
              <h2 className="mt-4 text-base font-semibold">{t(item.titleKey)}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(item.descKey)}</p>
              {item.external ? (
                <a href={item.href} target="_blank" rel="noreferrer" className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
                  {t("public.openResource")}
                </a>
              ) : (
                <Link to={item.href} className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
                  {t("public.openResource")}
                </Link>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
