import { Suspense, lazy, type ComponentType } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";
import { AdminRefineProvider } from "@/components/admin/AdminRefineProvider";
import { Layout } from "@/components/layout/Layout";
import { useTranslation } from "@/i18n/I18nProvider";
import { useAuthStore } from "@/stores/auth";

const Home = lazy(() => import("@/pages/Home").then((m) => ({ default: m.Home })));
const Agent = lazy(() => import("@/pages/Agent").then((m) => ({ default: m.Agent })));
const RunDetail = lazy(() =>
  import("@/pages/RunDetail").then((m) => ({ default: m.RunDetail })),
);
const Compare = lazy(() =>
  import("@/pages/Compare").then((m) => ({ default: m.Compare })),
);
const Admin = lazy(() =>
  import("@/pages/Admin").then((m) => ({ default: m.Admin })),
);
const OperatorLogin = lazy(() =>
  import("@/pages/OperatorLogin").then((m) => ({ default: m.OperatorLogin })),
);
const Correlation = lazy(() =>
  import("@/pages/Correlation").then((m) => ({ default: m.Correlation })),
);
const AlphaZoo = lazy(() =>
  import("@/pages/AlphaZoo").then((m) => ({ default: m.AlphaZoo })),
);
const StrategyMarket = lazy(() =>
  import("@/pages/StrategyMarket").then((m) => ({ default: m.StrategyMarket })),
);
const StrategyLibrary = lazy(() =>
  import("@/pages/StrategyLibrary").then((m) => ({ default: m.StrategyLibrary })),
);
const StrategyEdit = lazy(() =>
  import("@/pages/StrategyEdit").then((m) => ({ default: m.StrategyEdit })),
);
const StrategyCockpit = lazy(() =>
  import("@/pages/StrategyCockpit").then((m) => ({ default: m.StrategyCockpit })),
);
const ShadowTrading = lazy(() =>
  import("@/pages/ShadowTrading").then((m) => ({ default: m.ShadowTrading })),
);
const LiveTrading = lazy(() =>
  import("@/pages/LiveTrading").then((m) => ({ default: m.LiveTrading })),
);
const Auth = lazy(() => import("@/pages/Auth").then((m) => ({ default: m.Auth })));
const PersonalSettings = lazy(() =>
  import("@/pages/PersonalSettings").then((m) => ({ default: m.PersonalSettings })),
);
const PublicLayout = lazy(() =>
  import("@/pages/PublicPages").then((m) => ({ default: m.PublicLayout })),
);
const PublicPage = lazy(() =>
  import("@/pages/PublicPages").then((m) => ({ default: m.PublicPage })),
);

function PageLoader() {
  const { t } = useTranslation();
  return (
    <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
      {t("app.loading")}
    </div>
  );
}

function wrap(Component: ComponentType) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

function RequireAuth() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

function AdminRoute() {
  return <AdminRefineProvider>{wrap(Admin)}</AdminRefineProvider>;
}

export const router = createBrowserRouter([
  { path: "/login", element: wrap(Auth) },
  { path: "/operator/login", element: wrap(OperatorLogin) },
  { path: "/operator", element: <AdminRoute /> },
  { path: "/settings", element: <Navigate to="/operator#settings" replace /> },
  {
    element: wrap(PublicLayout),
    children: [
      { path: "/", element: wrap(PublicPage) },
      { path: "/market", element: wrap(StrategyMarket) },
      { path: "/masters", element: wrap(PublicPage) },
      { path: "/library", element: wrap(PublicPage) },
      { path: "/community", element: wrap(PublicPage) },
      { path: "/api-docs", element: wrap(PublicPage) },
      { path: "/public/:pageId", element: wrap(PublicPage) },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: "/dashboard", element: wrap(Home) },
          { path: "/cockpit", element: wrap(StrategyCockpit) },
          { path: "/agent", element: wrap(Agent) },
          { path: "/strategies", element: wrap(StrategyLibrary) },
          { path: "/m/add-strategy", element: wrap(StrategyEdit) },
          { path: "/m/edit-strategy/:strategyId", element: wrap(StrategyEdit) },
          { path: "/shadow-trading", element: wrap(ShadowTrading) },
          { path: "/live-trading", element: wrap(LiveTrading) },
          { path: "/personal-settings", element: wrap(PersonalSettings) },
          { path: "/runs/:runId", element: wrap(RunDetail) },
          { path: "/compare", element: wrap(Compare) },
          { path: "/correlation", element: wrap(Correlation) },
          { path: "/alpha-zoo", element: wrap(AlphaZoo) },
          { path: "/alpha-zoo/bench", element: wrap(AlphaZoo) },
          { path: "/alpha-zoo/compare", element: wrap(AlphaZoo) },
          { path: "/alpha-zoo/:alphaId", element: wrap(AlphaZoo) },
        ],
      },
    ],
  },
]);
