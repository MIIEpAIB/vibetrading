import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, RefreshCw, Search, UserCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { LanguageToggle } from "@/components/layout/LanguageToggle";
import { api, type SocialUser } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/I18nProvider";

type CommunityTab = "discover" | "following" | "followers";

export function Community() {
  const { language } = useTranslation();
  const navigate = useNavigate();
  const zh = language === "zh-CN";
  const copy = zh ? {
    eyebrow: "交易者网络", title: "社区", subtitle: "发现其他交易者，管理关注关系，或直接发起私信。",
    discover: "发现用户", following: "我关注的", followers: "关注我的", search: "搜索用户名或显示名",
    follow: "关注", followingLabel: "已关注", message: "发私信", followersCount: "粉丝", followingCount: "关注",
    emptyDiscover: "暂时没有匹配的用户。搜索其他用户名试试。", emptyFollowing: "你还没有关注任何用户。去“发现用户”看看。",
    emptyFollowers: "目前还没有关注者。", loading: "正在加载…", refresh: "刷新", searchError: "搜索用户失败",
    loadError: "加载社区用户失败", followError: "更新关注状态失败", dmError: "无法打开私信会话",
  } : {
    eyebrow: "Trader network", title: "Community", subtitle: "Discover traders, manage your follows, or start a direct conversation.",
    discover: "Discover", following: "Following", followers: "Followers", search: "Search username or display name",
    follow: "Follow", followingLabel: "Following", message: "Message", followersCount: "followers", followingCount: "following",
    emptyDiscover: "No matching users yet. Try another search.", emptyFollowing: "You are not following anyone yet. Find people in Discover.",
    emptyFollowers: "You do not have followers yet.", loading: "Loading…", refresh: "Refresh", searchError: "Failed to search users",
    loadError: "Failed to load community users", followError: "Failed to update follow", dmError: "Could not open direct message",
  };
  const [tab, setTab] = useState<CommunityTab>("discover");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<SocialUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  const loadUsers = async (nextTab = tab, search = query) => {
    setLoading(true);
    try {
      const response = nextTab === "following"
        ? await api.listFollowing()
        : nextTab === "followers"
          ? await api.listFollowers()
          : await api.searchSocialUsers(search);
      setUsers(response.users);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : nextTab === "discover" ? copy.searchError : copy.loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadUsers("discover", ""); }, []);

  const visibleUsers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || tab === "discover") return users;
    return users.filter((user) => `${user.username} ${user.display_name}`.toLocaleLowerCase().includes(needle));
  }, [query, tab, users]);

  const changeTab = (next: CommunityTab) => {
    setTab(next);
    void loadUsers(next, next === "discover" ? query : "");
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    if (tab !== "discover") setTab("discover");
    void loadUsers("discover", query);
  };

  const toggleFollow = async (user: SocialUser) => {
    setBusyUserId(user.user_id);
    try {
      const updated = user.is_following ? await api.unfollowUser(user.user_id) : await api.followUser(user.user_id);
      setUsers((current) => current.map((item) => item.user_id === updated.user_id ? updated : item));
      if (tab === "following" && !updated.is_following) {
        setUsers((current) => current.filter((item) => item.user_id !== updated.user_id));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.followError);
    } finally {
      setBusyUserId(null);
    }
  };

  const startMessage = async (user: SocialUser) => {
    setBusyUserId(user.user_id);
    try {
      const thread = await api.createDirectMessageThread({ recipient_user_id: user.user_id });
      navigate(`/messages?threadId=${encodeURIComponent(thread.thread_id)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.dmError);
    } finally {
      setBusyUserId(null);
    }
  };

  const tabs: { id: CommunityTab; label: string }[] = [
    { id: "discover", label: copy.discover }, { id: "following", label: copy.following }, { id: "followers", label: copy.followers },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Users className="h-4 w-4" />{copy.eyebrow}</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
        <LanguageToggle />
      </div>

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {tabs.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => changeTab(item.id)}
                className={cn("shrink-0 rounded-md px-3 py-2 text-sm font-medium", tab === item.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <form onSubmit={search} className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search}
                className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" />
            </form>
            <button type="button" onClick={() => void loadUsers()} title={copy.refresh} aria-label={copy.refresh}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border hover:bg-muted">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">{copy.loading}</div>
        ) : visibleUsers.length ? (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleUsers.map((user) => {
              const name = user.display_name || user.username;
              const busy = busyUserId === user.user_id;
              return (
                <article key={user.user_id} className="flex min-w-0 items-center gap-3 rounded-lg border p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                    {name.slice(0, 1).toLocaleUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{name}</div>
                    <div className="truncate text-sm text-muted-foreground">@{user.username}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{user.follower_count} {copy.followersCount} · {user.following_count} {copy.followingCount}</div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button type="button" disabled={busy} onClick={() => void toggleFollow(user)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                      {user.is_following ? <UserCheck className="h-3.5 w-3.5 text-primary" /> : <UserPlus className="h-3.5 w-3.5" />}
                      {user.is_following ? copy.followingLabel : copy.follow}
                    </button>
                    <button type="button" disabled={busy} onClick={() => void startMessage(user)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                      <MessageCircle className="h-3.5 w-3.5" />{copy.message}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center text-sm text-muted-foreground">
            {tab === "discover" ? copy.emptyDiscover : tab === "following" ? copy.emptyFollowing : copy.emptyFollowers}
          </div>
        )}
      </section>
    </main>
  );
}
