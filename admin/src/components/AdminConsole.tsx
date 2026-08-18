"use client";

import { useEffect, useMemo, useState } from "react";
import {
  api,
  getApiKey,
  setApiKey,
  type AdminChatMessage,
  type AdminDashboardResponse,
  type AdminUserUsageRow,
  type JsonObject,
  type StrategyMarketAdminItem,
} from "@/lib/api";

type UserDraft = {
  display_name: string;
  password: string;
  revoke_tokens: boolean;
};

const nav = [
  ["overview", "运营看板"],
  ["settings", "系统设置"],
  ["users", "用户管理"],
  ["chat", "后台查看聊天"],
  ["market", "策略商城"],
  ["usage", "调用情况"],
] as const;

type AdminSection = (typeof nav)[number][0];

function formatPercent(part: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function jsonPretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function splitTerms(value: string) {
  return value
    .split(/[\n,，;；]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function maskTerms(content: string, terms: string[]) {
  return terms.reduce((text, term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(escaped, "gi"), "***");
  }, content);
}

function Metric({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
    </div>
  );
}

function ChatModerationTable({
  rows,
  masked,
  terms,
  onDeleteUser,
}: {
  rows: AdminChatMessage[];
  masked: boolean;
  terms: string[];
  onDeleteUser: (userId: number) => void;
}) {
  return (
    <div className="table-wrap chat-table-wrap">
      <table className="chat-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>来源</th>
            <th>用户</th>
            <th>会话</th>
            <th>角色</th>
            <th>内容</th>
            <th>敏感词</th>
            <th>处理</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.message_id}>
              <td>{row.created_at || "-"}</td>
              <td>{row.source === "direct_message" ? "用户私信" : "Agent 会话"}</td>
              <td>
                <strong>{row.display_name || row.username}</strong>
                <span>{row.username}{row.user_id != null ? ` · ID ${row.user_id}` : ""}</span>
              </td>
              <td>
                <strong>{row.session_title || "未命名会话"}</strong>
                <span>{row.session_id}</span>
              </td>
              <td>{row.role === "sender" ? "发送者" : row.role === "peer" ? "对方" : row.role}</td>
              <td className="message-cell">{masked ? maskTerms(row.content, terms) : row.content}</td>
              <td>
                {row.matched_terms.length ? (
                  <div className="term-list">
                    {row.matched_terms.map((term) => <span key={term}>{term}</span>)}
                  </div>
                ) : "-"}
              </td>
              <td>
                {row.user_id != null ? (
                  <button className="danger" onClick={() => onDeleteUser(row.user_id!)}>删除账号</button>
                ) : "-"}
              </td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={8} className="empty-cell">暂无聊天记录</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function UsageTable({ rows }: { rows: AdminUserUsageRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>用户</th>
            <th>会话</th>
            <th>消息</th>
            <th>调用</th>
            <th>策略</th>
            <th>最近活跃</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.user_id ?? "operator"}-${row.username}`}>
              <td>
                <strong>{row.display_name || row.username}</strong>
                <span>{row.username}</span>
              </td>
              <td>{row.session_count}</td>
              <td>{row.message_count}</td>
              <td>{row.attempt_count}</td>
              <td>{row.strategy_count}</td>
              <td>{row.last_message_at || row.last_session_at || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsEditor({
  title,
  value,
  onSave,
}: {
  title: string;
  value: JsonObject | null;
  onSave: (value: JsonObject) => Promise<void>;
}) {
  const [draft, setDraft] = useState("{}");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(jsonPretty(value));
  }, [value]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(JSON.parse(draft) as JsonObject);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-title">
        <h3>{title}</h3>
        <button onClick={save} disabled={saving}>{saving ? "保存中" : "保存"}</button>
      </div>
      <textarea
        className="json-editor"
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </div>
  );
}

export function AdminConsole() {
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [chatMessages, setChatMessages] = useState<AdminChatMessage[]>([]);
  const [chatStats, setChatStats] = useState({ total: 0, scanned: 0 });
  const [chatQuery, setChatQuery] = useState("");
  const [chatUserId, setChatUserId] = useState("");
  const [sensitiveWords, setSensitiveWords] = useState("");
  const [maskSensitive, setMaskSensitive] = useState(true);
  const [marketItems, setMarketItems] = useState<StrategyMarketAdminItem[]>([]);
  const [llmSettings, setLlmSettings] = useState<JsonObject | null>(null);
  const [dataSourceSettings, setDataSourceSettings] = useState<JsonObject | null>(null);
  const [userDrafts, setUserDrafts] = useState<Record<number, UserDraft>>({});
  const [loading, setLoading] = useState(false);
  const [savingMarket, setSavingMarket] = useState(false);
  const [message, setMessage] = useState("");
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [selectedMarketItem, setSelectedMarketItem] = useState<StrategyMarketAdminItem | null>(null);

  useEffect(() => {
    if (!selectedMarketItem) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedMarketItem(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selectedMarketItem]);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [dashboardResponse, chatResponse, marketResponse, llmResponse, dataSourceResponse] = await Promise.all([
        api.getAdminDashboard(),
        api.getAdminChatMessages({
          q: chatQuery.trim(),
          userId: chatUserId.trim() ? Number(chatUserId) : null,
          sensitiveWords,
        }),
        api.getAdminStrategyMarket(),
        api.getLLMSettings(),
        api.getDataSourceSettings(),
      ]);
      setDashboard(dashboardResponse);
      setChatMessages(chatResponse.messages);
      setChatStats({ total: chatResponse.total, scanned: chatResponse.scanned });
      setMarketItems(marketResponse.items);
      setLlmSettings(llmResponse);
      setDataSourceSettings(dataSourceResponse);
      const drafts: Record<number, UserDraft> = {};
      for (const user of dashboardResponse.users) {
        drafts[user.user_id] = {
          display_name: user.display_name,
          password: "",
          revoke_tokens: false,
        };
      }
      setUserDrafts(drafts);
      setAuthenticated(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载失败");
      if (error instanceof Error && error.message.includes("401")) setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const saved = getApiKey();
    setApiKeyDraft(saved);
    if (saved) void load();
  }, []);

  const summary = dashboard?.summary;
  const completionRate = summary ? formatPercent(summary.completed_attempts, summary.total_attempts) : "0%";
  const enabledItems = useMemo(() => marketItems.filter((item) => item.enabled).length, [marketItems]);
  const featuredItems = useMemo(() => marketItems.filter((item) => item.featured).length, [marketItems]);
  const moderationTerms = useMemo(() => splitTerms(sensitiveWords), [sensitiveWords]);

  const login = async () => {
    setApiKey(apiKeyDraft);
    await load();
  };

  const logout = () => {
    setApiKey("");
    setAuthenticated(false);
    setDashboard(null);
    setMarketItems([]);
  };

  const updateUser = async (userId: number) => {
    const draft = userDrafts[userId];
    if (!draft) return;
    await api.updateAdminUser(userId, {
      display_name: draft.display_name,
      password: draft.password || undefined,
      revoke_tokens: draft.revoke_tokens,
    });
    setMessage("用户已更新");
    await load();
  };

  const deleteUser = async (userId: number) => {
    await api.deleteAdminUser(userId);
    setMessage("用户已删除");
    await load();
  };

  const searchChat = async () => {
    setLoading(true);
    setMessage("");
    try {
      const chatResponse = await api.getAdminChatMessages({
        q: chatQuery.trim(),
        userId: chatUserId.trim() ? Number(chatUserId) : null,
        sensitiveWords,
      });
      setChatMessages(chatResponse.messages);
      setChatStats({ total: chatResponse.total, scanned: chatResponse.scanned });
      setMessage("聊天记录已刷新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "聊天记录加载失败");
    } finally {
      setLoading(false);
    }
  };

  const saveMarket = async () => {
    setSavingMarket(true);
    try {
      const response = await api.updateAdminStrategyMarket(marketItems);
      setMarketItems(response.items);
      setMessage("策略商城已保存");
    } finally {
      setSavingMarket(false);
    }
  };

  const updateMarketItem = (id: string, patch: Partial<StrategyMarketAdminItem>) => {
    setMarketItems((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const saveMarketItem = async (item: StrategyMarketAdminItem) => {
    setSavingMarket(true);
    try {
      const nextItems = marketItems.map((row) => row.id === item.id ? item : row);
      const response = await api.updateAdminStrategyMarket(nextItems);
      setMarketItems(response.items);
      setMessage(`${item.name || item.id} 已保存`);
    } finally {
      setSavingMarket(false);
    }
  };

  const deleteMarketItem = async (item: StrategyMarketAdminItem) => {
    const label = item.name || item.id;
    if (!window.confirm(`确认删除策略“${label}”？删除后将无法恢复。`)) return;

    setSavingMarket(true);
    try {
      const response = await api.deleteAdminStrategyMarket(item.id);
      setMarketItems(response.items);
      setMessage(`${label} 已删除`);
    } finally {
      setSavingMarket(false);
    }
  };

  if (!authenticated) {
    return (
      <main className="login-page">
        <section className="login-panel">
          <div>
            <p className="eyebrow">Vibe Trading Admin</p>
            <h1>运营后台</h1>
            <p className="muted">输入后端 API Key 后进入独立 Next.js 管理端。</p>
          </div>
          <label>
            API Key
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void login();
              }}
            />
          </label>
          <button className="primary" onClick={login} disabled={loading || !apiKeyDraft.trim()}>
            {loading ? "验证中" : "进入后台"}
          </button>
          {message ? <p className="error">{message}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <div className="admin-shell">
      <aside>
        <div className="brand">
          <span>VT</span>
          <div>
            <strong>Vibe Trading</strong>
            <small>Next Admin</small>
          </div>
        </div>
        <nav>
          {nav.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`nav-button${activeSection === id ? " active" : ""}`}
              aria-current={activeSection === id ? "page" : undefined}
              onClick={() => setActiveSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="ghost" onClick={logout}>退出</button>
      </aside>

      <main>
        <header>
          <div>
            <p className="eyebrow">Operator Console</p>
            <h1>大后台</h1>
          </div>
          <div className="toolbar">
            {message ? <span>{message}</span> : null}
            <button className="primary" onClick={() => setActiveSection("chat")}>后台查看聊天</button>
            <button onClick={load} disabled={loading}>{loading ? "刷新中" : "刷新"}</button>
          </div>
        </header>

        {activeSection === "overview" ? <section id="overview" className="section">
          <div className="section-title">
            <h2>运营看板</h2>
            <p>用户、Agent 调用和策略商城发布状态。</p>
          </div>
          <div className="metrics">
            <Metric label="用户" value={summary?.total_users ?? 0} detail={`会话 ${summary?.total_sessions ?? 0}`} />
            <Metric label="Agent 调用" value={summary?.total_attempts ?? 0} detail={`完成率 ${completionRate}`} />
            <Metric label="失败调用" value={summary?.failed_attempts ?? 0} detail={`运行中 ${summary?.running_attempts ?? 0}`} />
            <Metric label="策略商城" value={marketItems.length} detail={`启用 ${enabledItems} / 推荐 ${featuredItems}`} />
          </div>
        </section> : null}

        {activeSection === "settings" ? <section id="settings" className="section">
          <div className="section-title">
            <h2>系统设置</h2>
            <p>直接对接现有设置 API，保存前会校验 JSON 格式。</p>
          </div>
          <div className="settings-grid">
            <SettingsEditor
              title="LLM 设置"
              value={llmSettings}
              onSave={async (value) => {
                setLlmSettings(await api.updateLLMSettings(value));
                setMessage("LLM 设置已保存");
              }}
            />
            <SettingsEditor
              title="数据源设置"
              value={dataSourceSettings}
              onSave={async (value) => {
                setDataSourceSettings(await api.updateDataSourceSettings(value));
                setMessage("数据源设置已保存");
              }}
            />
          </div>
        </section> : null}

        {activeSection === "users" ? <section id="users" className="section">
          <div className="section-title">
            <h2>用户管理</h2>
            <p>更新显示名、重置密码、吊销令牌或删除用户。</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>用户名</th>
                  <th>显示名</th>
                  <th>创建时间</th>
                  <th>新密码</th>
                  <th>踢下线</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(dashboard?.users ?? []).map((user) => {
                  const draft = userDrafts[user.user_id] ?? { display_name: user.display_name, password: "", revoke_tokens: false };
                  return (
                    <tr key={user.user_id}>
                      <td>{user.user_id}</td>
                      <td><strong>{user.username}</strong></td>
                      <td>
                        <input
                          value={draft.display_name}
                          onChange={(event) => setUserDrafts((prev) => ({
                            ...prev,
                            [user.user_id]: { ...draft, display_name: event.target.value },
                          }))}
                        />
                      </td>
                      <td>{user.created_at}</td>
                      <td>
                        <input
                          type="password"
                          value={draft.password}
                          onChange={(event) => setUserDrafts((prev) => ({
                            ...prev,
                            [user.user_id]: { ...draft, password: event.target.value },
                          }))}
                          placeholder="留空不修改"
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={draft.revoke_tokens}
                          onChange={(event) => setUserDrafts((prev) => ({
                            ...prev,
                            [user.user_id]: { ...draft, revoke_tokens: event.target.checked },
                          }))}
                        />
                      </td>
                      <td>
                        <div className="table-actions">
                          <button onClick={() => void updateUser(user.user_id)}>更新</button>
                          <button className="danger" onClick={() => void deleteUser(user.user_id)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!(dashboard?.users ?? []).length ? (
                  <tr>
                    <td colSpan={7} className="empty-cell">暂无用户</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section> : null}

        {activeSection === "chat" ? <section id="chat" className="section">
          <div className="section-title row">
            <div>
              <h2>聊天审计</h2>
              <p>展示所有用户会话消息，支持按用户、关键词和敏感词命中筛选。</p>
            </div>
            <button onClick={searchChat} disabled={loading}>{loading ? "查询中" : "查询聊天"}</button>
          </div>
          <div className="moderation-controls">
            <label>
              内容搜索
              <input
                value={chatQuery}
                onChange={(event) => setChatQuery(event.target.value)}
                placeholder="输入消息关键词"
              />
            </label>
            <label>
              用户 ID
              <input
                inputMode="numeric"
                value={chatUserId}
                onChange={(event) => setChatUserId(event.target.value.replace(/\D/g, ""))}
                placeholder="留空查看全部用户"
              />
            </label>
            <label>
              敏感词
              <textarea
                className="terms-editor"
                value={sensitiveWords}
                onChange={(event) => setSensitiveWords(event.target.value)}
                placeholder="多个敏感词用逗号或换行分隔"
              />
            </label>
            <label className="check-row moderation-toggle">
              <input
                type="checkbox"
                checked={maskSensitive}
                onChange={(event) => setMaskSensitive(event.target.checked)}
              />
              遮蔽命中词
            </label>
          </div>
          <div className="audit-summary">
            <span>显示 {chatStats.total} 条</span>
            <span>扫描 {chatStats.scanned} 条</span>
            <span>敏感词 {moderationTerms.length} 个</span>
          </div>
          <ChatModerationTable
            rows={chatMessages}
            masked={maskSensitive}
            terms={moderationTerms}
            onDeleteUser={(userId) => void deleteUser(userId)}
          />
        </section> : null}

        {activeSection === "market" ? <section id="market" className="section">
          <div className="section-title row">
            <div>
              <h2>策略商城</h2>
              <p>统一调用 `/admin/strategy-market` 管理发布状态。</p>
            </div>
            <button onClick={saveMarket} disabled={savingMarket}>{savingMarket ? "保存中" : "保存商城"}</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>策略</th>
                  <th>类型</th>
                  <th>状态</th>
                  <th>价格</th>
                  <th>备注</th>
                  <th>启用</th>
                  <th>推荐</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {marketItems.map((item) => (
                  <tr key={item.id}>
                      <td>
                        <button
                          className="strategy-name-button"
                          onClick={() => setSelectedMarketItem(item)}
                        >
                          {item.name || item.id}
                        </button>
                        <span>{item.kind === "community" ? `${item.id} · 用户 ${item.owner_user_id ?? "-"}` : item.id}</span>
                      </td>
                      <td>{item.kind}</td>
                      <td>
                        <select
                          value={item.status}
                          onChange={(event) => updateMarketItem(item.id, { status: event.target.value })}
                        >
                          <option value="draft">draft</option>
                          {item.kind === "community" ? <option value="submitted">submitted</option> : null}
                          <option value="published">published</option>
                          {item.kind === "community" ? <option value="rejected">rejected</option> : null}
                          <option value="hidden">hidden</option>
                          <option value="archived">archived</option>
                        </select>
                      </td>
                      <td>
                        <input
                          value={item.price}
                          onChange={(event) => updateMarketItem(item.id, { price: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          value={item.note}
                          onChange={(event) => updateMarketItem(item.id, { note: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(event) => updateMarketItem(item.id, { enabled: event.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={item.featured}
                          onChange={(event) => updateMarketItem(item.id, { featured: event.target.checked })}
                        />
                      </td>
                      <td>
                        <div className="table-actions">
                          <button onClick={() => setSelectedMarketItem(item)}>查看详情</button>
                          <button onClick={() => void saveMarketItem(item)} disabled={savingMarket}>保存</button>
                          <button className="danger" onClick={() => void deleteMarketItem(item)} disabled={savingMarket}>删除</button>
                        </div>
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section> : null}

        {activeSection === "usage" ? <section id="usage" className="section">
          <div className="section-title">
            <h2>Agent 调用情况</h2>
            <p>按用户聚合会话、消息、调用和策略数量。</p>
          </div>
          <UsageTable rows={dashboard?.usage ?? []} />
        </section> : null}
      </main>
      {selectedMarketItem ? (
        <div className="strategy-modal-backdrop" onMouseDown={() => setSelectedMarketItem(null)}>
          <section
            className="strategy-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="strategy-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="strategy-modal-header">
              <div>
                <span className="eyebrow">策略详情</span>
                <h2 id="strategy-modal-title">{selectedMarketItem.name || selectedMarketItem.id}</h2>
                <p>{selectedMarketItem.kind} · {selectedMarketItem.id}</p>
              </div>
              <button
                className="modal-close"
                aria-label="关闭策略详情"
                onClick={() => setSelectedMarketItem(null)}
              >
                ×
              </button>
            </div>
            <div className="strategy-detail">
              <div className="strategy-detail-meta">
                <div><strong>来源策略</strong><span>{selectedMarketItem.source_strategy_id || "-"}</span></div>
                <div><strong>语言</strong><span>{selectedMarketItem.language || "-"}</span></div>
                <div><strong>分类</strong><span>{selectedMarketItem.category || "-"}</span></div>
                <div><strong>所有者</strong><span>{selectedMarketItem.owner_user_id ?? "平台"}</span></div>
                <div><strong>状态</strong><span>{selectedMarketItem.status}</span></div>
                <div><strong>更新时间</strong><span>{selectedMarketItem.updated_at || "-"}</span></div>
              </div>
              <div className="strategy-detail-copy">
                <strong>策略简介</strong>
                <p>{selectedMarketItem.description || selectedMarketItem.note || "暂无简介"}</p>
              </div>
              {selectedMarketItem.strategy_description ? (
                <div className="strategy-detail-copy">
                  <strong>策略说明</strong>
                  <p>{selectedMarketItem.strategy_description}</p>
                </div>
              ) : null}
              {selectedMarketItem.tags?.length ? (
                <div className="strategy-detail-copy">
                  <strong>标签</strong>
                  <div className="strategy-tags">{selectedMarketItem.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                </div>
              ) : null}
              {selectedMarketItem.risk_warnings?.length ? (
                <div className="strategy-detail-copy">
                  <strong>风险提示</strong>
                  <ul>{selectedMarketItem.risk_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              ) : null}
              {selectedMarketItem.code_snapshot ? (
                <div className="strategy-detail-copy">
                  <strong>策略代码</strong>
                  <pre>{selectedMarketItem.code_snapshot}</pre>
                </div>
              ) : null}
              {selectedMarketItem.backtest_summary && Object.keys(selectedMarketItem.backtest_summary).length ? (
                <div className="strategy-detail-copy">
                  <strong>回测摘要</strong>
                  <pre>{JSON.stringify(selectedMarketItem.backtest_summary, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
