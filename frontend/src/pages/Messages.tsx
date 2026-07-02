import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Inbox, MessageCircle, Search, Send, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  api,
  type DirectMessage,
  type DirectMessageThread,
  type SocialUser,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/I18nProvider";
import { useAuthStore } from "@/stores/auth";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function displayName(user: { username: string; display_name: string }) {
  return user.display_name || user.username;
}

export function Messages() {
  const { language } = useTranslation();
  const currentUser = useAuthStore((state) => state.user);
  const copy = useMemo(() => language === "zh-CN" ? {
    title: "私信",
    subtitle: "和真实用户一对一聊天，关注后更方便持续沟通。",
    searchPlaceholder: "搜索用户名或显示名",
    search: "搜索",
    emptyThreads: "还没有私信会话",
    emptyMessages: "选择一个会话或搜索用户开始聊天",
    messagePlaceholder: "输入私信内容",
    send: "发送",
    startChat: "私信",
    follow: "关注",
    following: "已关注",
    followers: "粉丝",
    follows: "关注",
    noUsers: "没有找到用户",
  } : {
    title: "Messages",
    subtitle: "Chat one-to-one with real users and follow people you want to keep up with.",
    searchPlaceholder: "Search username or display name",
    search: "Search",
    emptyThreads: "No direct messages yet",
    emptyMessages: "Select a thread or search users to start chatting",
    messagePlaceholder: "Type a direct message",
    send: "Send",
    startChat: "Message",
    follow: "Follow",
    following: "Following",
    followers: "Followers",
    follows: "Following",
    noUsers: "No users found",
  }, [language]);

  const [threads, setThreads] = useState<DirectMessageThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<SocialUser[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");

  const activeThread = threads.find((thread) => thread.thread_id === activeThreadId) ?? null;

  const loadThreads = async () => {
    const response = await api.listDirectMessageThreads();
    setThreads(response.threads);
    if (!activeThreadId && response.threads.length) {
      setActiveThreadId(response.threads[0].thread_id);
    }
  };

  useEffect(() => {
    let alive = true;
    api.listDirectMessageThreads()
      .then((response) => {
        if (!alive) return;
        setThreads(response.threads);
        if (response.threads.length) setActiveThreadId(response.threads[0].thread_id);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load messages"))
      .finally(() => {
        if (alive) setLoadingThreads(false);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadThreads().catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    let alive = true;
    setLoadingMessages(true);
    api.listDirectMessages(activeThreadId)
      .then(async (response) => {
        if (!alive) return;
        setMessages(response.messages);
        await api.markDirectMessageThreadRead(activeThreadId);
        await loadThreads();
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load thread"))
      .finally(() => {
        if (alive) setLoadingMessages(false);
      });
    return () => { alive = false; };
  }, [activeThreadId]);

  const searchUsers = async (event?: FormEvent) => {
    event?.preventDefault();
    try {
      const response = await api.searchSocialUsers(query);
      setUsers(response.users);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to search users");
    }
  };

  const toggleFollow = async (user: SocialUser) => {
    try {
      const next = user.is_following ? await api.unfollowUser(user.user_id) : await api.followUser(user.user_id);
      setUsers((current) => current.map((item) => item.user_id === next.user_id ? next : item));
      setThreads((current) => current.map((thread) => (
        thread.peer.user_id === next.user_id ? { ...thread, peer: next } : thread
      )));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update follow");
    }
  };

  const startThread = async (user: SocialUser) => {
    try {
      const thread = await api.createDirectMessageThread({ recipient_user_id: user.user_id });
      await loadThreads();
      setActiveThreadId(thread.thread_id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start message");
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeThreadId || !draft.trim()) return;
    setSending(true);
    try {
      const sent = await api.sendDirectMessage(activeThreadId, draft);
      setMessages((current) => [...current, sent]);
      setDraft("");
      await loadThreads();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-full bg-muted/30 p-4 sm:p-6">
      <div className="mb-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary">
          <MessageCircle className="h-4 w-4" />
          {copy.title}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
      </div>

      <div className="grid min-h-[calc(100vh-190px)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-[560px] flex-col rounded-lg border bg-card shadow-sm">
          <form onSubmit={searchUsers} className="border-b p-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
                />
              </div>
              <button type="submit" className="rounded-md border px-3 text-sm font-semibold hover:bg-muted">
                {copy.search}
              </button>
            </div>
          </form>

          {users.length ? (
            <div className="border-b p-2">
              {users.map((user) => (
                <div key={user.user_id} className="flex items-center gap-2 rounded-md p-2 hover:bg-muted/60">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {displayName(user).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{displayName(user)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      @{user.username} · {user.follower_count} {copy.followers}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleFollow(user)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted"
                    title={user.is_following ? copy.following : copy.follow}
                  >
                    {user.is_following ? <UserCheck className="h-4 w-4 text-primary" /> : <UserPlus className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void startThread(user)}
                    className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    {copy.startChat}
                  </button>
                </div>
              ))}
            </div>
          ) : query ? (
            <div className="border-b px-4 py-3 text-xs text-muted-foreground">{copy.noUsers}</div>
          ) : null}

          <div className="flex-1 overflow-y-auto p-2">
            {loadingThreads ? (
              <div className="p-3 text-sm text-muted-foreground">Loading...</div>
            ) : threads.length ? threads.map((thread) => (
              <button
                key={thread.thread_id}
                type="button"
                onClick={() => setActiveThreadId(thread.thread_id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md p-3 text-left transition-colors",
                  activeThreadId === thread.thread_id ? "bg-primary/10 text-primary" : "hover:bg-muted",
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">
                  {displayName(thread.peer).slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{displayName(thread.peer)}</span>
                    {thread.unread_count ? (
                      <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                        {thread.unread_count}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {thread.last_message?.content || "No messages yet"}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{formatTime(thread.updated_at)}</div>
                </div>
              </button>
            )) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8" />
                {copy.emptyThreads}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-[560px] flex-col rounded-lg border bg-card shadow-sm">
          {activeThread ? (
            <>
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">{displayName(activeThread.peer)}</div>
                  <div className="text-xs text-muted-foreground">@{activeThread.peer.username}</div>
                </div>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {loadingMessages ? (
                  <div className="text-sm text-muted-foreground">Loading...</div>
                ) : messages.length ? messages.map((message) => {
                  const mine = currentUser?.user_id === message.sender.user_id;
                  return (
                    <div key={message.message_id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[78%] rounded-lg px-3 py-2 text-sm",
                        mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                      )}>
                        <div className="whitespace-pre-wrap break-words">{message.content}</div>
                        <div className={cn("mt-1 text-[11px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                          {formatTime(message.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    {copy.emptyMessages}
                  </div>
                )}
              </div>
              <form onSubmit={sendMessage} className="flex gap-2 border-t p-3">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={copy.messagePlaceholder}
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {copy.send}
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <MessageCircle className="h-10 w-10" />
              <div className="text-sm">{copy.emptyMessages}</div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
