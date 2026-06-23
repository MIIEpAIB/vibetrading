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
  Star,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";

type PublicPageId = "market" | "masters" | "library" | "community" | "api-docs";

interface PublicPageConfig {
  id: PublicPageId;
  path: string;
  label: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  accent: string;
  stats: Array<{ label: string; value: string }>;
  highlights: Array<{ title: string; desc: string; meta: string; icon: LucideIcon }>;
}

const PUBLIC_PAGES: PublicPageConfig[] = [
  {
    id: "market",
    path: "/market",
    label: "策略商城",
    title: "策略商城",
    subtitle: "发现可学习、可复制、可进入影子盘验证的加密与多市场策略模板。",
    icon: ShoppingBag,
    accent: "from-orange-500 to-teal-500",
    stats: [
      { label: "精选策略", value: "128" },
      { label: "可影子验证", value: "42" },
      { label: "新手模板", value: "18" },
    ],
    highlights: [
      { title: "BTC 趋势跟随组合", desc: "均线、波动率过滤、分批止盈与最大回撤保护。", meta: "适合新手 · 现货优先", icon: TrendingUp },
      { title: "ETH 震荡网格模板", desc: "网格间距、仓位上限、极端行情暂停规则完整。", meta: "影子盘推荐", icon: Compass },
      { title: "多币种动量轮动", desc: "BTC/ETH/SOL/BNB 横截面排序，周频再平衡。", meta: "进阶策略", icon: Sparkles },
    ],
  },
  {
    id: "masters",
    path: "/masters",
    label: "围观大神",
    title: "围观大神",
    subtitle: "观察高质量交易者如何拆解行情、验证策略、控制风险和复盘决策。",
    icon: Star,
    accent: "from-amber-500 to-sky-500",
    stats: [
      { label: "公开组合", value: "36" },
      { label: "本周复盘", value: "91" },
      { label: "风险样例", value: "24" },
    ],
    highlights: [
      { title: "趋势派：只做高胜率突破", desc: "从入场等待、假突破过滤到移动止损的完整流程。", meta: "公开复盘", icon: TrendingUp },
      { title: "网格派：先活下来再盈利", desc: "展示仓位梯度、价格带失效和暂停规则。", meta: "风险教学", icon: Compass },
      { title: "量化派：先证伪再上线", desc: "从 Alpha 假设、样本外验证到影子盘观察清单。", meta: "量化实践", icon: Code2 },
    ],
  },
  {
    id: "library",
    path: "/library",
    label: "文库",
    title: "文库",
    subtitle: "沉淀交易、量化、回测、交易所 API、风控和影子盘过渡实盘的知识文档。",
    icon: BookOpen,
    accent: "from-teal-500 to-indigo-500",
    stats: [
      { label: "文章", value: "260" },
      { label: "新手路径", value: "12" },
      { label: "实盘清单", value: "9" },
    ],
    highlights: [
      { title: "懂交易但不懂量化：入门路径", desc: "把主观交易规则转成信号、参数、回测和影子观察项。", meta: "新手必读", icon: FileText },
      { title: "懂量化但不懂交易：市场常识", desc: "交易成本、滑点、流动性、交易所规则和持仓心理。", meta: "交易基础", icon: BookOpen },
      { title: "从影子盘到实盘的 12 个门槛", desc: "成交样本、异常订单、亏损上限、确认模式和熔断机制。", meta: "上线检查", icon: Sparkles },
    ],
  },
  {
    id: "community",
    path: "/community",
    label: "社区",
    title: "社区",
    subtitle: "和交易者、开发者、策略作者一起讨论想法、复盘失败、共建策略模板。",
    icon: Users,
    accent: "from-sky-500 to-orange-500",
    stats: [
      { label: "讨论主题", value: "1.8k" },
      { label: "策略共创", value: "314" },
      { label: "今日活跃", value: "86" },
    ],
    highlights: [
      { title: "策略诊断区", desc: "提交策略逻辑，社区一起找未来函数、过拟合和风控漏洞。", meta: "开放讨论", icon: MessageSquare },
      { title: "交易复盘区", desc: "记录错过机会、过早止盈、追涨杀跌和执行偏差。", meta: "行为修正", icon: FileText },
      { title: "交易所接入区", desc: "讨论 OKX、Binance、Bybit 等连接器配置与常见错误。", meta: "开发协作", icon: Code2 },
    ],
  },
  {
    id: "api-docs",
    path: "/api-docs",
    label: "API 文档",
    title: "API 文档",
    subtitle: "面向开发者的策略、影子盘、Alpha、会话和实盘授权接口说明。",
    icon: Code2,
    accent: "from-slate-700 to-teal-500",
    stats: [
      { label: "接口模块", value: "8" },
      { label: "示例请求", value: "54" },
      { label: "安全规则", value: "16" },
    ],
    highlights: [
      { title: "Strategy Library API", desc: "策略列表、创建、替换、删除和标签字段约定。", meta: "REST", icon: Code2 },
      { title: "Shadow Trading API", desc: "虚拟账户、订单状态机、行情触发和成交记录。", meta: "Sandbox", icon: Compass },
      { title: "Live Mandate API", desc: "授权提交、确认模式、过期、熔断和审计边界。", meta: "Safety", icon: Sparkles },
    ],
  },
];

function getPublicPage(id?: string): PublicPageConfig {
  return PUBLIC_PAGES.find((page) => page.id === id) ?? PUBLIC_PAGES[0];
}

export function PublicLayout() {
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
                {page.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block">
              <LanguageToggle />
            </div>
            <Link
              to={user ? "/dashboard" : "/login"}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              <LogIn className="h-4 w-4" />
              {user ? "进入工作台" : "登录"}
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
              {page.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

export function PublicPage() {
  const { pageId } = useParams();
  const { pathname } = useLocation();
  const pathPage = PUBLIC_PAGES.find((item) => item.path === pathname);
  const page = pathPage ?? getPublicPage(pageId);
  const Icon = page.icon;

  return (
    <main>
      <section className="border-b bg-card">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:px-8">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Icon className="h-3.5 w-3.5 text-primary" />
              Venus Public
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-normal sm:text-4xl">{page.title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{page.subtitle}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                <LogIn className="h-4 w-4" />
                登录体验完整功能
              </Link>
              <Link
                to="/library"
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <BookOpen className="h-4 w-4" />
                查看新手文库
              </Link>
            </div>
          </div>
          <div className="rounded-lg border bg-background p-4">
            <div className={cn("flex h-24 items-center justify-center rounded-md bg-gradient-to-br text-white", page.accent)}>
              <Icon className="h-10 w-10" />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {page.stats.map((stat) => (
                <div key={stat.label} className="rounded-md border bg-card p-3">
                  <div className="font-mono text-lg font-semibold">{stat.value}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:px-6 lg:grid-cols-3 lg:px-8">
        {page.highlights.map((item) => {
          const ItemIcon = item.icon;
          return (
            <article key={item.title} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <ItemIcon className="h-4 w-4" />
                </div>
                <span className="rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {item.meta}
                </span>
              </div>
              <h2 className="mt-4 text-base font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.desc}</p>
            </article>
          );
        })}
      </section>
    </main>
  );
}
