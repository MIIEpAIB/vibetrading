#!/usr/bin/env python3
"""Vibe-Trading API Server - RESTful API for finance research and backtesting.

V5: ReAct Agent + async /run + CORS env + SSE tool events.
"""

from __future__ import annotations

import asyncio
import hmac
import ipaddress
import json
import logging
import os
import re
import signal
import time
import csv
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request, Security, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from rich.console import Console

from src.direct_messages import DirectMessageStore
from src.goal.context import default_goal_criteria
from src.social_graph import SocialGraphStore
from src.ui_services import build_run_analysis, load_run_context

# UTF-8 on Windows
import sys as _sys
for _s in ("stdout", "stderr"):
    _r = getattr(getattr(_sys, _s, None), "reconfigure", None)
    if callable(_r):
        _r(encoding="utf-8", errors="replace")

RUNS_DIR = Path(__file__).resolve().parent / "runs"
SESSIONS_DIR = Path(__file__).resolve().parent / "sessions"
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
AGENT_DIR = Path(__file__).resolve().parent
ENV_PATH = AGENT_DIR / ".env"
ENV_EXAMPLE_PATH = AGENT_DIR / ".env.example"
STRATEGY_MARKET_ADMIN_PATH = AGENT_DIR / "strategy_market_admin.json"
DIRECT_MESSAGES_PATH = AGENT_DIR / "direct_messages.json"
SOCIAL_GRAPH_PATH = AGENT_DIR / "social_graph.json"

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB
_UPLOAD_CHUNK_SIZE = 1024 * 1024  # 1 MB

console = Console()
logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv

    load_dotenv(ENV_PATH, override=False)
except Exception:
    pass


# ============================================================================
# Pydantic Models
# ============================================================================

class Artifact(BaseModel):
    """Artifact file metadata."""
    name: str = Field(..., description="File name")
    path: str = Field(..., description="File path")
    type: str = Field(..., description="File type: csv, json, txt, etc.")
    size: int = Field(..., description="Size in bytes")
    exists: bool = Field(..., description="Whether the file exists")


class BacktestMetrics(BaseModel):
    """Backtest summary metrics."""
    model_config = {"extra": "allow"}

    final_value: float = Field(..., description="Ending portfolio value")
    total_return: float = Field(..., description="Total return")
    annual_return: float = Field(..., description="Annualized return")
    max_drawdown: float = Field(..., description="Max drawdown")
    sharpe: float = Field(..., description="Sharpe ratio")
    win_rate: float = Field(..., description="Win rate")
    trade_count: int = Field(..., description="Number of trades")



class RAGSelection(BaseModel):
    """RAG routing result."""
    selected_api: str = Field(..., description="Selected API code")
    selected_name: str = Field(..., description="Selected API name")
    selected_score: float = Field(..., description="Match score")


class RunInfo(BaseModel):
    """Compact run row for list views."""
    run_id: str
    status: str
    created_at: str
    prompt: Optional[str] = None
    total_return: Optional[float] = None
    sharpe: Optional[float] = None
    codes: List[str] = Field(default_factory=list)
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class RunResponse(BaseModel):
    """API response payload for a single run."""

    status: str = Field(..., description="Run status: success, failed, aborted")
    run_id: str = Field(..., description="Run identifier")
    elapsed_seconds: float = Field(..., description="Execution time in seconds")
    reason: Optional[str] = Field(None, description="Failure reason when available")

    planner_output: Optional[Dict[str, Any]] = Field(None, description="Planner output")
    strategy_spec: Optional[Dict[str, Any]] = Field(None, description="Strategy specification")
    rag_selection: Optional[RAGSelection] = Field(None, description="Selected RAG metadata")

    metrics: Optional[BacktestMetrics] = Field(None, description="Backtest metrics")
    artifacts: List[Artifact] = Field(default_factory=list, description="Run artifacts")
    run_card: Optional[Dict[str, Any]] = Field(None, description="Trust Layer run card payload")

    equity_curve: Optional[List[Dict[str, Any]]] = Field(None, description="Equity preview")
    trade_log: Optional[List[Dict[str, Any]]] = Field(None, description="Trade preview")

    artifacts_equity_csv: Optional[List[Dict[str, Any]]] = Field(None, description="Full equity rows")
    artifacts_metrics_csv: Optional[List[Dict[str, Any]]] = Field(None, description="Full metrics rows")
    artifacts_trades_csv: Optional[List[Dict[str, Any]]] = Field(None, description="Full trade rows")
    validation: Optional[Dict[str, Any]] = Field(None, description="Statistical validation results")

    run_directory: str = Field(..., description="Run directory path")
    run_stage: Optional[str] = Field(None, description="UI-facing run stage")
    run_context: Optional[Dict[str, Any]] = Field(None, description="Normalized request context")
    price_series: Optional[Dict[str, List[Dict[str, Any]]]] = Field(None, description="Grouped OHLC series")
    indicator_series: Optional[Dict[str, Dict[str, List[Dict[str, Any]]]]] = Field(
        None,
        description="Grouped indicator overlays",
    )
    trade_markers: Optional[List[Dict[str, Any]]] = Field(None, description="Trade markers for charts")
    run_logs: Optional[List[Dict[str, Any]]] = Field(None, description="Structured stdout/stderr lines")


class HealthResponse(BaseModel):
    """Health check payload."""
    status: str = Field(..., description="Service status")
    service: str = Field(..., description="Service name")
    timestamp: str = Field(..., description="Server timestamp")


class LLMProviderOption(BaseModel):
    """Supported LLM provider metadata for the settings UI."""

    name: str
    label: str
    api_key_env: Optional[str] = None
    base_url_env: str
    default_model: str
    default_base_url: str
    api_key_required: bool = True
    auth_type: str = "api_key"
    login_command: Optional[str] = None


class LLMSettingsResponse(BaseModel):
    """Current LLM runtime settings."""

    provider: str
    model_name: str
    base_url: str
    api_key_env: Optional[str] = None
    api_key_configured: bool
    api_key_hint: Optional[str] = None
    api_key_required: bool
    temperature: float
    timeout_seconds: int
    max_retries: int
    reasoning_effort: str
    sse_timeout_seconds: int
    env_path: str
    providers: List[LLMProviderOption]


class UpdateLLMSettingsRequest(BaseModel):
    """Update LLM settings persisted to agent/.env."""

    provider: str = Field(..., min_length=1)
    model_name: str = Field(..., min_length=1)
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    clear_api_key: bool = False
    temperature: float = 0.0
    timeout_seconds: int = Field(120, ge=1, le=3600)
    max_retries: int = Field(2, ge=0, le=20)
    reasoning_effort: Optional[str] = None


class DataSourceSettingsResponse(BaseModel):
    """Current data source credential settings."""

    tushare_token_configured: bool
    tushare_token_hint: Optional[str] = None
    baostock_supported: bool
    baostock_installed: bool
    baostock_message: str
    env_path: str


class UpdateDataSourceSettingsRequest(BaseModel):
    """Update project-local data source credentials."""

    tushare_token: Optional[str] = None
    clear_tushare_token: bool = False


class CryptoStorageStatusResponse(BaseModel):
    """Public storage status for crypto dashboard K-line persistence."""

    redis: str = Field(..., description="Redis cache status: hit, miss, stored, disabled, or degraded")
    timescale: str = Field(..., description="TimescaleDB write status: stored, disabled, skipped, or degraded")
    detail: str = Field("", description="Optional non-secret detail")


class CryptoMarketAggregateResponse(BaseModel):
    """Aggregate crypto market metrics for dashboard boxes."""

    market_cap: float
    volume_24h: float
    open_interest: float
    liquidation_24h: float
    avg_change_24h: float
    btc_dominance: float


class CryptoMarketRowResponse(BaseModel):
    """Single row in the crypto market dashboard table."""

    rank: int
    symbol: str
    base: str
    name: str
    icon_url: str
    icon_bg: str
    icon_fg: str
    price: float
    change_24h: float
    high_24h: float
    low_24h: float
    volume_24h: float
    quote_volume_24h: float
    market_cap: float
    funding_rate: float
    open_interest: float
    liquidation_24h: float


class CryptoMarketsResponse(BaseModel):
    """Crypto dashboard market data payload."""

    status: str
    source: str
    updated_at: str
    symbols: List[str]
    aggregate: CryptoMarketAggregateResponse
    rows: List[CryptoMarketRowResponse]


class CryptoKlineBarResponse(BaseModel):
    """Normalized crypto OHLCV bar."""

    time: str
    timestamp: int
    symbol: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class CryptoKlinesResponse(BaseModel):
    """Crypto dashboard K-line response payload."""

    status: str
    symbol: str
    timeframe: str
    source: str
    updated_at: str
    storage: CryptoStorageStatusResponse
    bars: List[CryptoKlineBarResponse]


class ShadowWalletResponse(BaseModel):
    """Virtual shadow wallet row."""

    user_id: str
    account_type: str
    asset_name: str
    balance: float
    frozen: float
    equity: float


class ShadowOrderResponse(BaseModel):
    """Virtual shadow order state."""

    order_id: str
    user_id: str
    account_type: str
    symbol: str
    side: str
    type: str
    price: float
    quantity: float
    time_in_force: str = "GTC"
    status: str
    executed_price: float
    average_price: float = 0.0
    filled_quantity: float = 0.0
    remaining_quantity: float = 0.0
    executed_value: float = 0.0
    reserved_asset: str
    reserved_amount: float
    fee_asset: str = ""
    fee_paid: float = 0.0
    trigger_price: float = 0.0
    trigger_condition: str = ""
    trigger_order_type: str = ""
    trigger_order_price: float = 0.0
    triggered_at: float = 0.0
    rejection_reason: str = ""
    timestamp: float
    updated_at: float


class ShadowAccountResponse(BaseModel):
    """Virtual account snapshot for the Web UI."""

    user_id: str
    account_type: str
    wallets: List[ShadowWalletResponse]
    orders: List[ShadowOrderResponse]
    market_prices: Dict[str, float]


class ShadowPlaceOrderRequest(BaseModel):
    """Place a virtual shadow order."""

    symbol: str = Field(..., min_length=3, max_length=32)
    side: str = Field(..., description="BUY or SELL")
    order_type: str = Field("MARKET", description="MARKET, LIMIT, or TRIGGER")
    quantity: float = Field(..., gt=0)
    price: float = Field(0.0, ge=0)
    time_in_force: str = Field("GTC", description="GTC, IOC, FOK, or POST_ONLY")
    trigger_price: float = Field(0.0, ge=0)
    trigger_condition: str = Field("", description="GTE or LTE")
    trigger_order_type: str = Field("MARKET", description="MARKET or LIMIT")
    trigger_order_price: float = Field(0.0, ge=0)


class ShadowPriceUpdateRequest(BaseModel):
    """Inject a latest-market-price update for virtual limit order matching."""

    symbol: str = Field(..., min_length=3, max_length=32)
    price: float = Field(..., gt=0)


class ShadowPriceUpdateResponse(BaseModel):
    """Result of a virtual market-price update."""

    symbol: str
    price: float
    filled_orders: List[ShadowOrderResponse]
    account: ShadowAccountResponse


# ---- User Auth Models ----

class RegisterRequest(BaseModel):
    """Create an application user."""

    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8, max_length=256)
    display_name: Optional[str] = Field(None, max_length=191)


class LoginRequest(BaseModel):
    """Login with username and password."""

    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=256)


class AuthUserResponse(BaseModel):
    """Public authenticated user profile."""

    user_id: int
    username: str
    display_name: str
    created_at: str


class AuthTokenResponse(BaseModel):
    """Login/register response carrying a bearer token."""

    token: str
    token_type: str = "bearer"
    expires_at: str
    user: AuthUserResponse


class ChangePasswordRequest(BaseModel):
    """Change the current user's password."""

    current_password: str = Field(..., min_length=1, max_length=256)
    new_password: str = Field(..., min_length=8, max_length=256)


class ExchangeApiKeyBindingResponse(BaseModel):
    """Public exchange API credential metadata."""

    binding_id: int
    exchange: str
    label: str
    api_key_hint: str
    api_secret_configured: bool
    passphrase_configured: bool
    product_type: str
    margin_mode: str
    created_at: str
    updated_at: str


class ExchangeApiKeyBindingListResponse(BaseModel):
    """Current user's exchange API credential bindings."""

    bindings: List[ExchangeApiKeyBindingResponse]


class CreateExchangeApiKeyBindingRequest(BaseModel):
    """Create a user-owned exchange API credential binding."""

    exchange: str = Field(..., pattern="^(okx|binance)$")
    label: str = Field("", max_length=191)
    api_key: str = Field(..., min_length=1, max_length=512)
    api_secret: str = Field(..., min_length=1, max_length=2048)
    passphrase: str = Field("", max_length=512)
    product_type: str = Field("spot", pattern="^(spot|usdm_futures)$")
    margin_mode: str = Field("cross", pattern="^(cross|isolated)$")


class DirectMessageUserResponse(BaseModel):
    """Public user profile used by direct messages."""

    user_id: int
    username: str
    display_name: str


class SocialUserResponse(BaseModel):
    """Public social profile for follow and direct message surfaces."""

    user_id: int
    username: str
    display_name: str
    follower_count: int = 0
    following_count: int = 0
    is_following: bool = False


class DirectMessageThreadResponse(BaseModel):
    """One-to-one direct message thread."""

    thread_id: str
    peer: DirectMessageUserResponse
    created_at: str
    updated_at: str
    unread_count: int = 0
    last_message: Optional["DirectMessageResponse"] = None


class DirectMessageResponse(BaseModel):
    """A direct message payload."""

    message_id: str
    thread_id: str
    sender: DirectMessageUserResponse
    content: str
    created_at: str
    read_by_current_user: bool = False


class DirectMessageThreadListResponse(BaseModel):
    """List of current user's direct message threads."""

    threads: List[DirectMessageThreadResponse]


class DirectMessageListResponse(BaseModel):
    """List of messages in one direct message thread."""

    messages: List[DirectMessageResponse]


class DirectMessageUserSearchResponse(BaseModel):
    """Search result for users available to message."""

    users: List[DirectMessageUserResponse]


class SocialUserSearchResponse(BaseModel):
    """Search result for social users."""

    users: List[SocialUserResponse]


class CreateDirectMessageThreadRequest(BaseModel):
    """Create or return a one-to-one direct message thread."""

    recipient_user_id: Optional[int] = None
    recipient_username: Optional[str] = Field(None, min_length=1, max_length=64)
    initial_message: Optional[str] = Field(None, max_length=5000)


class SendDirectMessageRequest(BaseModel):
    """Send a direct message."""

    content: str = Field(..., min_length=1, max_length=5000)


class AdminUserUpdateRequest(BaseModel):
    """Operator-managed application user update."""

    display_name: Optional[str] = Field(None, max_length=191)
    password: Optional[str] = Field(None, min_length=8, max_length=256)
    revoke_tokens: bool = False


class AdminUsageSummary(BaseModel):
    """Operator dashboard aggregate metrics."""

    total_users: int = 0
    total_sessions: int = 0
    total_messages: int = 0
    total_attempts: int = 0
    running_attempts: int = 0
    failed_attempts: int = 0
    completed_attempts: int = 0
    total_strategies: int = 0


class AdminUserUsageRow(BaseModel):
    """Per-user agent usage row."""

    user_id: Optional[int] = None
    username: str = ""
    display_name: str = ""
    session_count: int = 0
    message_count: int = 0
    attempt_count: int = 0
    running_attempt_count: int = 0
    failed_attempt_count: int = 0
    completed_attempt_count: int = 0
    strategy_count: int = 0
    last_session_at: Optional[str] = None
    last_message_at: Optional[str] = None


class AdminDashboardResponse(BaseModel):
    """Operator dashboard response."""

    summary: AdminUsageSummary
    users: List[AuthUserResponse]
    usage: List[AdminUserUsageRow]


class AdminChatMessageResponse(BaseModel):
    """Operator-visible chat message row for moderation."""

    source: str = "agent_session"
    message_id: str
    session_id: str
    session_title: str = ""
    role: str
    content: str
    created_at: str
    linked_attempt_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    user_id: Optional[int] = None
    username: str = ""
    display_name: str = ""
    matched_terms: List[str] = Field(default_factory=list)


class AdminChatMessagesResponse(BaseModel):
    """Operator chat moderation list."""

    messages: List[AdminChatMessageResponse]
    total: int
    scanned: int


class StrategyMarketAdminItem(BaseModel):
    """Operator-managed strategy market item metadata."""

    id: str = Field(..., min_length=1, max_length=128)
    kind: str = Field("built-in", pattern="^(built-in|paid|community)$")
    enabled: bool = True
    featured: bool = False
    price: str = Field("", max_length=64)
    status: str = Field("published", pattern="^(draft|submitted|published|rejected|hidden|archived)$")
    note: str = Field("", max_length=500)
    updated_at: str = ""
    name: str = ""
    owner_user_id: Optional[int] = None
    source_strategy_id: str = ""


class StrategyMarketAdminResponse(BaseModel):
    """Operator-managed strategy market config."""

    items: List[StrategyMarketAdminItem]


class StrategyMarketAdminUpdateRequest(BaseModel):
    """Replace the operator-managed strategy market config."""

    items: List[StrategyMarketAdminItem] = Field(default_factory=list)


# ---- V4 Session Models ----

class CreateSessionRequest(BaseModel):
    """Create session request body."""
    title: str = Field("", description="Session title")
    config: Optional[Dict[str, Any]] = Field(None, description="Session config")


class SessionResponse(BaseModel):
    """Session record."""
    session_id: str
    title: str
    status: str
    created_at: str
    updated_at: str
    last_attempt_id: Optional[str] = None


class SendMessageRequest(BaseModel):
    """Send chat message: natural-language strategy description."""
    content: str = Field(..., description="Natural language strategy description", min_length=1, max_length=5000)


class MessageResponse(BaseModel):
    """Stored chat message."""
    message_id: str
    session_id: str
    role: str
    content: str
    created_at: str
    linked_attempt_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class CreateGoalRequest(BaseModel):
    """Create or replace a finance research goal."""

    objective: str = Field(..., min_length=1, max_length=5000)
    criteria: List[str] = Field(default_factory=list)
    ui_summary: str = ""
    protocol: str = "thesis_review"
    risk_tier: str = "research_general"
    token_budget: Optional[int] = Field(None, ge=1)
    turn_budget: Optional[int] = Field(None, ge=1)
    time_budget_seconds: Optional[int] = Field(None, ge=1)


class UpdateGoalRequest(BaseModel):
    """Edit mutable finance research goal fields."""

    goal_id: str = Field(..., min_length=1)
    expected_goal_id: str = Field(..., min_length=1)
    objective: Optional[str] = Field(None, min_length=1, max_length=5000)
    ui_summary: Optional[str] = Field(None, max_length=500)


class AddGoalEvidenceRequest(BaseModel):
    """Append evidence to a finance research goal."""

    goal_id: str = Field(..., min_length=1)
    expected_goal_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1, max_length=10000)
    criterion_id: Optional[str] = None
    claim_id: Optional[str] = None
    evidence_type: str = "evidence"
    tool_call_id: Optional[str] = None
    run_id: Optional[str] = None
    source_provider: Optional[str] = None
    source_type: Optional[str] = None
    source_uri: Optional[str] = None
    symbol_universe: List[str] = Field(default_factory=list)
    benchmark: List[str] = Field(default_factory=list)
    timeframe: Optional[str] = None
    method: Optional[str] = None
    assumptions: Dict[str, Any] = Field(default_factory=dict)
    artifact_path: Optional[str] = None
    artifact_hash: Optional[str] = None
    data_as_of: Optional[str] = None
    confidence: Optional[str] = None
    caveat: Optional[str] = None
    contradicts_claim_ids: List[str] = Field(default_factory=list)


class GoalSnapshotResponse(BaseModel):
    """Finance research goal snapshot."""

    goal: Dict[str, Any]
    claims: List[Dict[str, Any]]
    criteria: List[Dict[str, Any]]
    evidence: List[Dict[str, Any]]
    evidence_count: int = 0


class AddGoalEvidenceResponse(BaseModel):
    """Response after appending goal evidence."""

    evidence: Dict[str, Any]
    snapshot: GoalSnapshotResponse


class GoalAuditRowRequest(BaseModel):
    """One criterion row for goal status audits."""

    criterion_id: str = Field(..., min_length=1)
    result: str = Field(..., min_length=1)
    evidence_ids: List[str] = Field(default_factory=list)
    notes: str = ""


class UpdateGoalStatusRequest(BaseModel):
    """Update a finance research goal status."""

    goal_id: str = Field(..., min_length=1)
    expected_goal_id: str = Field(..., min_length=1)
    status: str = Field(..., min_length=1)
    audit: List[GoalAuditRowRequest] = Field(default_factory=list)
    recap: Optional[str] = None


class UpdateGoalStatusResponse(BaseModel):
    """Response after changing a goal status."""

    goal: Dict[str, Any]
    snapshot: GoalSnapshotResponse


class UpdateGoalResponse(BaseModel):
    """Response after editing a goal."""

    goal: Dict[str, Any]
    snapshot: GoalSnapshotResponse


class StrategyLibraryItem(BaseModel):
    """Personal strategy library item."""

    id: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=500)
    description: str = ""
    strategyDescription: str = ""
    language: str = "python"
    category: str = "trend"
    status: str = "draft"
    tags: List[str] = Field(default_factory=list)
    code: str = Field(..., min_length=1)
    createdAt: str
    updatedAt: str
    shareStatus: str = "none"


class StrategyLibraryResponse(BaseModel):
    """Strategy library list response."""

    strategies: List[StrategyLibraryItem]


class PublicStrategyMarketItem(BaseModel):
    """Published strategy snapshot available in the public strategy market."""

    publicId: str
    sourceStrategyId: str
    name: str
    summary: str
    description: str = ""
    strategyDescription: str = ""
    language: str = "python"
    category: str = "trend"
    tags: List[str] = Field(default_factory=list)
    codeSnapshot: str
    reviewStatus: str = "published"
    publishedAt: str
    updatedAt: str
    backtestSummary: Dict[str, Any] = Field(default_factory=dict)
    riskWarnings: List[str] = Field(default_factory=list)


class PublicStrategyMarketResponse(BaseModel):
    """List of published community strategies."""

    strategies: List[PublicStrategyMarketItem]


class ReplaceStrategyLibraryRequest(BaseModel):
    """Replace all strategy library rows."""

    strategies: List[StrategyLibraryItem] = Field(default_factory=list)


class StrategyMarketBacktestRequest(BaseModel):
    """Run a real backtest for a whitelisted marketplace strategy."""

    strategy_id: str = Field(..., min_length=1, max_length=128)
    start_date: str = "2024-01-01"
    end_date: str = "2026-06-27"
    symbol: Optional[str] = None
    interval: Optional[str] = None


class StrategyMarketBacktestResponse(BaseModel):
    """Marketplace real-backtest response."""

    strategy_id: str
    status: str
    run_id: str
    run_directory: str
    symbol: str
    timeframe: str
    period: str
    totalReturnPct: float
    annualizedReturnPct: float
    maxDrawdownPct: float
    sharpe: float
    winRatePct: float
    tradeCount: int
    engine: str
    assumptions: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class StrategyBacktestRequest(BaseModel):
    """Run a real backtest for a user-owned strategy."""

    start_date: str = "2024-01-01"
    end_date: str = "2026-06-27"
    symbol: str = "BTC-USDT"
    interval: str = "4H"
    source: str = "okx"
    initial_capital: float = Field(100000.0, gt=0)


class PaperDeploymentCreateRequest(BaseModel):
    """Create a paper deployment from a saved strategy."""

    strategy_id: str = Field(..., min_length=1, max_length=128)
    limits: Dict[str, Any] = Field(default_factory=dict)
    execution_mode: str = Field("shadow", description="shadow or broker_paper")
    connector_profile_id: str = Field("", max_length=128)


class PaperDeploymentActionResponse(BaseModel):
    """Paper deployment action response."""

    deployment: Dict[str, Any]


class PaperDeploymentListResponse(BaseModel):
    """Paper deployment list response."""

    deployments: List[Dict[str, Any]]


class PaperDeploymentStatusResponse(BaseModel):
    """Paper deployment status response."""

    deployment: Dict[str, Any]
    latest_tick: Optional[Dict[str, Any]] = None
    recent_ticks: List[Dict[str, Any]] = Field(default_factory=list)
    recent_signals: List[Dict[str, Any]] = Field(default_factory=list)
    recent_decisions: List[Dict[str, Any]] = Field(default_factory=list)
    recent_orders: List[Dict[str, Any]] = Field(default_factory=list)
    summary: Dict[str, Any] = Field(default_factory=dict)


class PaperTickResponse(BaseModel):
    """Paper deployment manual tick response."""

    tick: Dict[str, Any]
    signal: Optional[Dict[str, Any]] = None
    decision: Optional[Dict[str, Any]] = None
    order_link: Optional[Dict[str, Any]] = None


# ---- Live trading channel: consent commit + kill switch ----


class CommitMandateRequest(BaseModel):
    """Surface-originated mandate commit (Consent §1 / §3).

    This is the ONLY write path that activates a live-trading mandate. It is a
    privileged HTTP action the user surface sends on an explicit click/keypress
    — NOT a tool the agent model can call. ``consent_ack`` MUST be ``true``.
    """

    broker: str = Field(..., min_length=1, max_length=64)
    proposal_id: str = Field(..., min_length=1, max_length=128)
    selected_ordinal: int = Field(..., ge=1, le=10)
    adjustments: Optional[Dict[str, Any]] = None
    consent_ack: bool = Field(..., description="Explicit affirmative; must be true")
    session_id: Optional[str] = None
    account_ref: str = Field("", max_length=128)
    lifetime_days: int = Field(30, ge=1, le=365)


class LiveHaltRequest(BaseModel):
    """Trip or clear the live kill switch (Consent §4).

    Tripping/clearing is a privileged surface action, never an agent tool. When
    ``broker`` is omitted the GLOBAL switch is used (halts every broker).
    """

    broker: Optional[str] = Field(None, max_length=64)
    reason: str = Field("user requested halt", max_length=500)
    session_id: Optional[str] = None


class LiveAuthorizeRequest(BaseModel):
    """Kick off (or describe) the OAuth bootstrap for a live broker (C2).

    Vibe-Trading never holds funds and never operates a venue, so the OAuth
    bootstrap runs through the broker's own user-authorized device flow on the
    client (CLI / desktop MCP), not a server-side redirect. This endpoint is the
    web on-ramp: it tells a Web UI user exactly how to discover/start the flow.
    """

    broker: str = Field(..., min_length=1, max_length=64)


class LiveRunnerControlRequest(BaseModel):
    """Start or stop the persistent live runner for one broker (SPEC §7.5).

    The runner wakes on schedule/market events and trades autonomously inside a
    committed mandate. Starting it is a privileged surface action, never an
    agent tool. A committed, unexpired mandate must already exist.
    """

    broker: str = Field(..., min_length=1, max_length=64)
    session_id: Optional[str] = None


class CryptoLiveConfigureRequest(BaseModel):
    """Save user-owned crypto live connector credentials.

    This is a user-facing setup endpoint for strategy live deployment. Secrets
    are written to the existing connector config files under the runtime root
    with owner-only permissions by the connector SDK modules.
    """

    exchange: str = Field(..., pattern="^(okx|binance)$")
    product_type: str = Field("spot", pattern="^(spot|usdm_futures)$")
    api_key: str = Field(..., min_length=1, max_length=512)
    api_secret: str = Field(..., min_length=1, max_length=2048)
    passphrase: str = Field("", max_length=512)
    margin_mode: str = Field("cross", pattern="^(cross|isolated)$")
    check_connection: bool = Field(False, description="Run a read-only broker check after saving")


class CryptoLiveConfigureResponse(BaseModel):
    """Result of saving a crypto live connector config."""

    status: str
    exchange: str
    product_type: str
    profile_id: str
    config_path: str
    connection: Optional[Dict[str, Any]] = None


class LiveDeploymentCreateRequest(BaseModel):
    """Create a hosted live strategy deployment from a saved strategy."""

    strategy_id: str = Field(..., min_length=1, max_length=128)
    broker: str = Field(..., min_length=1, max_length=64)
    interval_seconds: int = Field(60, ge=5, le=86_400)
    session_id: Optional[str] = None
    limits: Dict[str, Any] = Field(default_factory=dict)


class LiveDeploymentActionResponse(BaseModel):
    """Hosted live deployment action response."""

    deployment: Dict[str, Any]
    runner: Dict[str, Any] = Field(default_factory=dict)


class LiveDeploymentListResponse(BaseModel):
    """Hosted live deployment list response."""

    deployments: List[Dict[str, Any]]


class BrokerAuthState(BaseModel):
    """Per-broker authorization snapshot for ``GET /live/status``."""

    broker: str
    oauth_token_present: bool = Field(..., description="Whether an OAuth token cache exists")
    is_live_broker: bool = Field(..., description="Whether this key is a recognized live broker")


class MandateLimits(BaseModel):
    """Flattened active-mandate limits surfaced to the UI (Mandate layer a/b)."""

    max_order_notional_usd: float
    max_total_exposure_usd: float
    max_leverage: float
    max_trades_per_day: int
    allowed_instruments: List[str]
    account_funding_usd: float


class ActiveMandateState(BaseModel):
    """Active-mandate snapshot with the expiry countdown (SPEC §9 dec. 2)."""

    broker: str
    account_ref: str
    created_at: str
    expires_at: str
    expires_in_seconds: Optional[int] = Field(
        None, description="Seconds until expiry; negative when already expired"
    )
    expired: bool
    limits: MandateLimits


class RunnerLivenessState(BaseModel):
    """Runner liveness snapshot via the §7.5 liveness contract."""

    broker: str
    alive: bool
    last_tick: Optional[float] = Field(None, description="Unix epoch of last heartbeat tick")
    last_tick_age_seconds: Optional[float] = None


class LiveBrokerStatus(BaseModel):
    """Combined live-channel status for a single broker."""

    auth: BrokerAuthState
    mandate: Optional[ActiveMandateState] = None
    runner: RunnerLivenessState
    halted: bool = Field(..., description="Per-broker OR global kill switch is tripped")


class LiveStatusResponse(BaseModel):
    """Top-level live-channel status (C2)."""

    global_halted: bool = Field(..., description="Whether the GLOBAL kill switch is tripped")
    brokers: List[LiveBrokerStatus]



# ============================================================================
# FastAPI Application
# ============================================================================

app = FastAPI(
    title="Vibe-Trading API",
    description="Vibe-Trading API: natural-language finance research, backtesting, and swarm workflows",
    version="5.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]


def _parse_cors_origins(raw: Optional[str]) -> List[str]:
    """Parse CORS origins and reject credentialed wildcard configuration.

    Args:
        raw: Comma-separated CORS origins from ``CORS_ORIGINS``. ``None`` or a
            blank value uses the loopback development defaults.

    Returns:
        Explicit CORS origins accepted by the API server.

    Raises:
        RuntimeError: If a wildcard origin is configured while credentials are
            enabled.
    """
    if raw is None or not raw.strip():
        return list(_DEFAULT_CORS_ORIGINS)
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    if "*" in origins:
        raise RuntimeError(
            "CORS_ORIGINS='*' is not allowed while credentials are enabled; "
            "configure explicit Web UI origins instead."
        )
    return origins


# CORS: override with CORS_ORIGINS (comma-separated explicit origins)
_CORS_ORIGINS = _parse_cors_origins(os.getenv("CORS_ORIGINS"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------------------
# SPA deep-link fallback
# ----------------------------------------------------------------------------
# A handful of API routes share their path with frontend SPA routes (e.g.
# ``/runs/{id}`` and ``/correlation``). Because FastAPI matches registered
# routes before the static SPA mount, a browser that refreshes or bookmarks
# one of these URLs would receive JSON (or 401/422) instead of the SPA shell.
# The middleware below serves ``frontend/dist/index.html`` when the request
# clearly came from a browser (``Accept`` contains ``text/html``); programmatic
# clients are routed to the real API handler as before.
#
# Patterns are written narrowly so the SPA shell only shadows paths that
# actually correspond to frontend pages. In particular ``/runs/{id}`` is
# the RunDetail page, but ``/runs/{id}/code`` and ``/runs/{id}/pine`` are
# API-only endpoints with no SPA route — using a broad ``/runs/`` prefix
# here would incorrectly hijack those when the browser sets ``Accept:
# text/html`` (e.g. a user pasting the URL into the address bar).

_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
_SPA_HTML_EXACT_PATHS: frozenset[str] = frozenset({"/correlation"})
# Each regex matches a complete request path. Trailing slash optional.
_SPA_HTML_PATH_REGEX: tuple[re.Pattern[str], ...] = (
    # ``/runs/{run_id}`` — RunDetail page. Excludes ``/runs/{id}/code``,
    # ``/runs/{id}/pine`` (API only) and ``/runs`` (collection endpoint).
    re.compile(r"^/runs/[^/]+/?$"),
)


def _is_spa_html_route(path: str) -> bool:
    """Return True when ``path`` corresponds to a frontend SPA page that
    shadows an API endpoint and should fall back to ``index.html`` on
    browser navigation."""
    if path in _SPA_HTML_EXACT_PATHS:
        return True
    return any(pattern.match(path) for pattern in _SPA_HTML_PATH_REGEX)


@app.middleware("http")
async def _spa_html_deep_link_fallback(request: Request, call_next):
    """Serve ``frontend/dist/index.html`` when a browser navigates directly to
    an SPA path that also exists as an API endpoint.

    Conflicts: ``/runs/{id}`` (RunDetail page vs API) and ``/correlation``
    (Correlation page vs API). Programmatic clients (``Accept: */*`` or
    ``application/json``) still hit the real API handler.
    """
    if request.method == "GET":
        accept = request.headers.get("accept", "")
        if "text/html" in accept and _is_spa_html_route(request.url.path):
            index = _FRONTEND_DIST / "index.html"
            if index.exists():
                return FileResponse(str(index))
    return await call_next(request)


@app.on_event("startup")
async def _run_startup_preflight() -> None:
    """Run preflight checks on server startup."""
    from src.preflight import run_preflight

    run_preflight(console)


# ============================================================================
# API Key Authentication
# ============================================================================

_security = HTTPBearer(auto_error=False)
_API_KEY = os.getenv("API_AUTH_KEY")
_SHELL_TOOLS_ENV = "VIBE_TRADING_ENABLE_SHELL_TOOLS"
_DOCKER_LOOPBACK_ENV = "VIBE_TRADING_TRUST_DOCKER_LOOPBACK"
_DEV_PROXY_AUTH_ENV = "VIBE_DEV_PROXY_AUTH"
_DEV_PROXY_AUTH_HEADER = "x-vibe-dev-proxy-auth"
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")


@dataclass(frozen=True)
class AuthContext:
    """Resolved API caller context."""

    user: Any | None = None
    operator: bool = False

    @property
    def user_id(self) -> int | None:
        return int(self.user.user_id) if self.user is not None else None


_auth_store = None


def _get_auth_store():
    """Return the MySQL-backed auth store."""
    from src.persistence import mysql_configured

    if not mysql_configured():
        raise HTTPException(status_code=501, detail="User login requires MySQL persistence")
    global _auth_store
    if _auth_store is None:
        from src.auth import MySQLAuthStore

        _auth_store = MySQLAuthStore()
    return _auth_store


def _configured_api_key() -> str:
    """Return the current API auth key, if configured."""
    return os.getenv("API_AUTH_KEY") or _API_KEY or ""


async def require_auth(
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> AuthContext:
    """Validate Bearer token for sensitive API endpoints.

    Args:
        request: Incoming HTTP request.
        cred: HTTP Bearer credentials extracted from the Authorization header.

    Raises:
        HTTPException: 403 when dev-mode auth is reached from a non-local client.
        HTTPException: 401 when API_AUTH_KEY is set but the token is missing or wrong.
    """
    return _resolve_auth_context(request=request, cred=cred)


async def require_event_stream_auth(
    request: Request,
    api_key: Optional[str] = Query(None),
    cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> AuthContext:
    """Validate auth for browser EventSource streams.

    Native EventSource cannot send custom Authorization headers, so event
    stream endpoints may accept the API key from the query string. Normal JSON
    endpoints must continue to use Bearer auth only.

    Args:
        request: Incoming HTTP request.
        api_key: Optional query-string API key for EventSource clients.
        cred: HTTP Bearer credentials extracted from the Authorization header.
    """
    return _resolve_auth_context(request=request, cred=cred, query_api_key=api_key, allow_query=True)


def _auth_credential_from_header_or_query(
    cred: Optional[HTTPAuthorizationCredentials],
    query_api_key: Optional[str],
    *,
    allow_query: bool,
) -> str:
    """Return the supplied API credential from the permitted source."""
    if cred and cred.credentials:
        return cred.credentials
    if allow_query and query_api_key:
        return query_api_key
    return ""


def _validate_api_auth(
    *,
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials],
    query_api_key: Optional[str] = None,
    allow_query: bool = False,
) -> None:
    """Validate configured auth, preserving loopback-only dev mode."""
    # Loopback clients are always trusted, even when API_AUTH_KEY is set.
    # The key only gates non-local (LAN/remote) access.
    if _is_local_client(request) or _has_trusted_dev_proxy_auth(request):
        return

    api_key = _configured_api_key()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API_AUTH_KEY is required for non-local API access",
        )

    token = _auth_credential_from_header_or_query(cred, query_api_key, allow_query=allow_query)
    if not token or not hmac.compare_digest(token, api_key):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _resolve_user_from_token(token: str) -> Any | None:
    """Return a user for an app auth token, or None when unavailable/invalid."""
    if not token:
        return None
    try:
        return _get_auth_store().user_for_token(token)
    except HTTPException:
        return None


def _resolve_auth_context(
    *,
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials],
    query_api_key: Optional[str] = None,
    allow_query: bool = False,
) -> AuthContext:
    """Resolve app-user auth first, then fall back to legacy operator auth."""
    token = _auth_credential_from_header_or_query(cred, query_api_key, allow_query=allow_query)
    api_key = _configured_api_key()
    if api_key and token and hmac.compare_digest(token, api_key):
        return AuthContext(user=None, operator=True)

    user = _resolve_user_from_token(token)
    if user is not None:
        return AuthContext(user=user, operator=False)

    _validate_api_auth(request=request, cred=cred, query_api_key=query_api_key, allow_query=allow_query)
    return AuthContext(user=None, operator=True)


def _is_local_client(request: Request) -> bool:
    """Return whether the request originates from a loopback client."""
    host = request.client.host if request.client else ""
    if host in {"localhost", "testclient"}:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    return _trusted_docker_loopback_ip(ip)


def _has_trusted_dev_proxy_auth(request: Request) -> bool:
    """Return whether this request was forwarded by the trusted dev proxy.

    ``start-dev.sh`` injects a random per-worktree token into both the FastAPI
    server and the Vite proxy. The browser never receives this token; it only
    lets the public dev frontend forward requests without requiring users to
    configure ``API_AUTH_KEY`` for quick server testing.
    """
    secret = os.getenv(_DEV_PROXY_AUTH_ENV, "").strip()
    if len(secret) < 16:
        return False
    token = request.headers.get(_DEV_PROXY_AUTH_HEADER, "").strip()
    return bool(token) and hmac.compare_digest(token, secret)


def _has_dev_proxy_header(request: Request) -> bool:
    """Return whether a request carries the dev-proxy marker header."""
    return bool(request.headers.get(_DEV_PROXY_AUTH_HEADER, "").strip())


def _validate_explicit_operator_bearer(
    *,
    cred: Optional[HTTPAuthorizationCredentials],
    missing_detail: str,
) -> None:
    """Validate an explicit operator bearer token without local/proxy bypasses."""
    api_key = _configured_api_key()
    if not api_key:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=missing_detail)

    token = _auth_credential_from_header_or_query(cred, None, allow_query=False)
    if not token or not hmac.compare_digest(token, api_key):
        raise HTTPException(status_code=401, detail="Invalid or missing operator API key")


def _env_flag_enabled(name: str) -> bool:
    """Return whether a boolean environment flag is enabled."""
    raw = os.getenv(name, "").strip()
    if raw:
        return raw.lower() in {"1", "true", "yes", "on"}
    try:
        raw = _read_env_values(ENV_PATH).get(name, "").strip()
    except Exception:
        raw = ""
    return raw.lower() in {"1", "true", "yes", "on"}


def _default_gateway_ips() -> set[ipaddress.IPv4Address]:
    """Return IPv4 default gateway addresses from Linux procfs."""
    gateways: set[ipaddress.IPv4Address] = set()
    try:
        lines = Path("/proc/net/route").read_text(encoding="utf-8").splitlines()
    except OSError:
        return gateways

    for line in lines[1:]:
        fields = line.split()
        if len(fields) < 3 or fields[1] != "00000000":
            continue
        try:
            raw = int(fields[2], 16).to_bytes(4, byteorder="little")
            gateways.add(ipaddress.IPv4Address(raw))
        except ValueError:
            continue
    return gateways


def _trusted_docker_loopback_ip(ip: ipaddress._BaseAddress) -> bool:
    """Return whether an IP is the trusted Docker host gateway.

    Docker Desktop presents host requests to a container as the bridge gateway
    instead of 127.0.0.1. This escape hatch is safe only when the published
    port is bound to host loopback, so the official compose file enables it
    together with a 127.0.0.1 port binding.
    """
    if not isinstance(ip, ipaddress.IPv4Address):
        return False
    if not _env_flag_enabled(_DOCKER_LOOPBACK_ENV):
        return False
    return ip in _default_gateway_ips()


def _env_shell_tools_enabled() -> bool:
    """Return whether server-side shell tools are explicitly enabled."""
    return _env_flag_enabled(_SHELL_TOOLS_ENV)


def _shell_tools_enabled_for_request(request: Request) -> bool:
    """Return whether this API request may expose shell tools to the agent."""
    return _is_local_client(request) or _env_shell_tools_enabled()


async def require_local_or_auth(
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> None:
    """Protect settings access when dev-mode auth is disabled.

    If API_AUTH_KEY is configured, require the bearer token. If not, allow only
    loopback clients so an API server bound to 0.0.0.0 cannot accept remote
    credential reads or writes in dev mode.
    """
    if _has_dev_proxy_header(request):
        _validate_explicit_operator_bearer(
            cred=cred,
            missing_detail="Settings access through the dev proxy requires API_AUTH_KEY",
        )
        return

    if _configured_api_key():
        _validate_api_auth(request=request, cred=cred)
        return
    if not (_is_local_client(request) or _has_trusted_dev_proxy_auth(request)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Settings access requires API_AUTH_KEY or a local loopback client",
        )


async def require_operator_auth(
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> None:
    """Require local/operator API access, not an application user token."""
    if _has_dev_proxy_header(request):
        _validate_explicit_operator_bearer(
            cred=cred,
            missing_detail="Operator access through the dev proxy requires API_AUTH_KEY",
        )
        return

    _validate_api_auth(request=request, cred=cred)


async def require_live_credential_config_auth(
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> None:
    """Require explicit local/operator authority for live credential writes.

    This endpoint saves server-wide exchange API keys. It must not accept
    application-user tokens or the dev-proxy trust header, because a publicly
    exposed Vite dev proxy would otherwise become a credential-write path.
    """
    if _is_local_client(request) and not _has_dev_proxy_header(request):
        return

    _validate_explicit_operator_bearer(
        cred=cred,
        missing_detail="Live credential configuration requires API_AUTH_KEY or local loopback access",
    )


def _validate_username(username: str) -> str:
    normalized = username.strip().lower()
    if not _USERNAME_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3-64 characters and use letters, numbers, dot, dash, or underscore.",
        )
    return normalized


def _auth_response(user: Any, token: str, expires_at: str) -> AuthTokenResponse:
    return AuthTokenResponse(
        token=token,
        expires_at=expires_at,
        user=AuthUserResponse(**user.to_dict()),
    )


@app.post("/auth/register", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
async def register_user(payload: RegisterRequest):
    """Register a new application user and return a bearer token."""
    username = _validate_username(payload.username)
    store = _get_auth_store()
    try:
        user = store.create_user(username, payload.password, payload.display_name)
    except Exception as exc:
        if exc.__class__.__name__ == "IntegrityError":
            raise HTTPException(status_code=409, detail="Username already exists") from exc
        raise
    token, expires_at = store.issue_token(user.user_id)
    return _auth_response(user, token, expires_at)


@app.post("/auth/login", response_model=AuthTokenResponse)
async def login_user(payload: LoginRequest):
    """Authenticate an application user."""
    username = payload.username.strip().lower()
    user = _get_auth_store().authenticate(username, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token, expires_at = _get_auth_store().issue_token(user.user_id)
    return _auth_response(user, token, expires_at)


@app.get("/auth/me", response_model=AuthUserResponse)
async def current_user(ctx: AuthContext = Depends(require_auth)):
    """Return the currently logged-in application user."""
    if ctx.user is None:
        raise HTTPException(status_code=401, detail="Login required")
    return AuthUserResponse(**ctx.user.to_dict())


@app.post("/auth/password")
async def change_current_user_password(
    payload: ChangePasswordRequest,
    ctx: AuthContext = Depends(require_auth),
):
    """Change the logged-in user's password."""
    if ctx.user is None or ctx.user_id is None:
        raise HTTPException(status_code=401, detail="Login required")
    changed = _get_auth_store().change_password(ctx.user_id, payload.current_password, payload.new_password)
    if not changed:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    return {"status": "ok"}


_direct_message_store: DirectMessageStore | None = None
_social_graph_store: SocialGraphStore | None = None


def _get_direct_message_store() -> DirectMessageStore:
    global _direct_message_store
    if _direct_message_store is None or _direct_message_store.path != DIRECT_MESSAGES_PATH:
        _direct_message_store = DirectMessageStore(DIRECT_MESSAGES_PATH)
    return _direct_message_store


def _get_social_graph_store() -> SocialGraphStore:
    global _social_graph_store
    if _social_graph_store is None or _social_graph_store.path != SOCIAL_GRAPH_PATH:
        _social_graph_store = SocialGraphStore(SOCIAL_GRAPH_PATH)
    return _social_graph_store


def _require_dm_user(ctx: AuthContext) -> int:
    if ctx.user is None or ctx.user_id is None:
        raise HTTPException(status_code=401, detail="Login required")
    return int(ctx.user_id)


def _dm_user_response(user: Any) -> DirectMessageUserResponse:
    return DirectMessageUserResponse(
        user_id=int(user.user_id),
        username=str(user.username),
        display_name=str(user.display_name),
    )


def _social_user_response(user: Any, current_user_id: int | None = None) -> SocialUserResponse:
    graph = _get_social_graph_store()
    user_id = int(user.user_id)
    return SocialUserResponse(
        user_id=user_id,
        username=str(user.username),
        display_name=str(user.display_name),
        follower_count=graph.follower_count(user_id),
        following_count=graph.following_count(user_id),
        is_following=bool(current_user_id and graph.is_following(current_user_id, user_id)),
    )


def _dm_user_map() -> dict[int, Any]:
    return {int(user.user_id): user for user in _get_auth_store().list_users(limit=1000)}


def _dm_find_user(*, user_id: int | None = None, username: str | None = None) -> Any | None:
    users = list(_dm_user_map().values())
    if user_id is not None:
        for user in users:
            if int(user.user_id) == int(user_id):
                return user
    if username:
        normalized = username.strip().lower()
        for user in users:
            if str(user.username).lower() == normalized:
                return user
    return None


def _dm_message_response(message: Any, users_by_id: dict[int, Any], current_user_id: int) -> DirectMessageResponse:
    sender = users_by_id.get(int(message.sender_user_id))
    if sender is None:
        sender = type("DeletedUser", (), {
            "user_id": int(message.sender_user_id),
            "username": f"user:{message.sender_user_id}",
            "display_name": "Deleted user",
        })()
    return DirectMessageResponse(
        message_id=message.message_id,
        thread_id=message.thread_id,
        sender=_dm_user_response(sender),
        content=message.content,
        created_at=message.created_at,
        read_by_current_user=int(current_user_id) in set(message.read_by),
    )


def _dm_thread_response(thread: Any, current_user_id: int, users_by_id: dict[int, Any]) -> DirectMessageThreadResponse:
    peer_id = next((item for item in thread.participant_user_ids if int(item) != int(current_user_id)), None)
    peer = users_by_id.get(int(peer_id)) if peer_id is not None else None
    if peer is None:
        peer = type("DeletedUser", (), {
            "user_id": int(peer_id or 0),
            "username": f"user:{peer_id or 0}",
            "display_name": "Deleted user",
        })()
    store = _get_direct_message_store()
    last_message = store.last_message(thread.thread_id)
    return DirectMessageThreadResponse(
        thread_id=thread.thread_id,
        peer=_dm_user_response(peer),
        created_at=thread.created_at,
        updated_at=thread.updated_at,
        unread_count=store.unread_count(thread.thread_id, current_user_id),
        last_message=_dm_message_response(last_message, users_by_id, current_user_id) if last_message else None,
    )


def _require_dm_thread_access(thread_id: str, user_id: int) -> Any:
    thread = _get_direct_message_store().get_thread(thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Direct message thread not found")
    if int(user_id) not in thread.participant_user_ids:
        raise HTTPException(status_code=403, detail="Direct message thread access denied")
    return thread


@app.get("/social/users", response_model=SocialUserSearchResponse)
async def search_social_users(
    query: str = Query("", max_length=64),
    ctx: AuthContext = Depends(require_auth),
):
    """Search application users with follow metadata."""
    current_user_id = _require_dm_user(ctx)
    needle = query.strip().lower()
    users = []
    for user in _get_auth_store().list_users(limit=1000):
        if int(user.user_id) == current_user_id:
            continue
        haystack = f"{user.username} {user.display_name}".lower()
        if needle and needle not in haystack:
            continue
        users.append(_social_user_response(user, current_user_id))
        if len(users) >= 20:
            break
    return {"users": users}


@app.get("/social/users/{user_id}", response_model=SocialUserResponse)
async def get_social_user(user_id: int, ctx: AuthContext = Depends(require_auth)):
    """Return one user's public social profile."""
    current_user_id = _require_dm_user(ctx)
    user = _dm_find_user(user_id=user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return _social_user_response(user, current_user_id)


@app.post("/social/follows/{user_id}", response_model=SocialUserResponse)
async def follow_user(user_id: int, ctx: AuthContext = Depends(require_auth)):
    """Follow another user."""
    current_user_id = _require_dm_user(ctx)
    user = _dm_find_user(user_id=user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        _get_social_graph_store().follow(current_user_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _social_user_response(user, current_user_id)


@app.delete("/social/follows/{user_id}", response_model=SocialUserResponse)
async def unfollow_user(user_id: int, ctx: AuthContext = Depends(require_auth)):
    """Unfollow another user."""
    current_user_id = _require_dm_user(ctx)
    user = _dm_find_user(user_id=user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    _get_social_graph_store().unfollow(current_user_id, user_id)
    return _social_user_response(user, current_user_id)


@app.get("/social/following", response_model=SocialUserSearchResponse)
async def list_following(
    user_id: Optional[int] = Query(None),
    ctx: AuthContext = Depends(require_auth),
):
    """List users followed by a user. Defaults to current user."""
    current_user_id = _require_dm_user(ctx)
    target_user_id = int(user_id or current_user_id)
    users_by_id = _dm_user_map()
    users = [
        _social_user_response(users_by_id[item], current_user_id)
        for item in _get_social_graph_store().following_ids(target_user_id)
        if item in users_by_id
    ]
    return {"users": users}


@app.get("/social/followers", response_model=SocialUserSearchResponse)
async def list_followers(
    user_id: Optional[int] = Query(None),
    ctx: AuthContext = Depends(require_auth),
):
    """List a user's followers. Defaults to current user."""
    current_user_id = _require_dm_user(ctx)
    target_user_id = int(user_id or current_user_id)
    users_by_id = _dm_user_map()
    users = [
        _social_user_response(users_by_id[item], current_user_id)
        for item in _get_social_graph_store().follower_ids(target_user_id)
        if item in users_by_id
    ]
    return {"users": users}


@app.get("/dm/users", response_model=DirectMessageUserSearchResponse)
async def search_direct_message_users(
    query: str = Query("", max_length=64),
    ctx: AuthContext = Depends(require_auth),
):
    """Search application users available for one-to-one direct messages."""
    current_user_id = _require_dm_user(ctx)
    needle = query.strip().lower()
    users = []
    for user in _get_auth_store().list_users(limit=1000):
        if int(user.user_id) == current_user_id:
            continue
        haystack = f"{user.username} {user.display_name}".lower()
        if needle and needle not in haystack:
            continue
        users.append(_dm_user_response(user))
        if len(users) >= 20:
            break
    return {"users": users}


@app.get("/dm/threads", response_model=DirectMessageThreadListResponse)
async def list_direct_message_threads(ctx: AuthContext = Depends(require_auth)):
    """List the current user's direct message threads."""
    current_user_id = _require_dm_user(ctx)
    users_by_id = _dm_user_map()
    threads = [
        _dm_thread_response(thread, current_user_id, users_by_id)
        for thread in _get_direct_message_store().list_threads(current_user_id)
    ]
    return {"threads": threads}


@app.post("/dm/threads", response_model=DirectMessageThreadResponse, status_code=status.HTTP_201_CREATED)
async def create_direct_message_thread(
    payload: CreateDirectMessageThreadRequest,
    ctx: AuthContext = Depends(require_auth),
):
    """Create or return a one-to-one direct message thread."""
    current_user_id = _require_dm_user(ctx)
    recipient = _dm_find_user(user_id=payload.recipient_user_id, username=payload.recipient_username)
    if recipient is None:
        raise HTTPException(status_code=404, detail="Recipient user not found")
    if int(recipient.user_id) == current_user_id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")

    store = _get_direct_message_store()
    thread = store.get_or_create_thread(current_user_id, int(recipient.user_id))
    if payload.initial_message and payload.initial_message.strip():
        store.send_message(thread.thread_id, current_user_id, payload.initial_message)
        thread = store.get_thread(thread.thread_id) or thread
    return _dm_thread_response(thread, current_user_id, _dm_user_map())


@app.get("/dm/threads/{thread_id}/messages", response_model=DirectMessageListResponse)
async def list_direct_messages(
    thread_id: str,
    limit: int = Query(100, ge=1, le=500),
    ctx: AuthContext = Depends(require_auth),
):
    """List messages in a direct message thread."""
    current_user_id = _require_dm_user(ctx)
    _require_dm_thread_access(thread_id, current_user_id)
    users_by_id = _dm_user_map()
    messages = [
        _dm_message_response(message, users_by_id, current_user_id)
        for message in _get_direct_message_store().list_messages(thread_id, limit=limit)
    ]
    return {"messages": messages}


@app.post("/dm/threads/{thread_id}/messages", response_model=DirectMessageResponse, status_code=status.HTTP_201_CREATED)
async def send_direct_message(
    thread_id: str,
    payload: SendDirectMessageRequest,
    ctx: AuthContext = Depends(require_auth),
):
    """Send a direct message in a thread."""
    current_user_id = _require_dm_user(ctx)
    _require_dm_thread_access(thread_id, current_user_id)
    try:
        message = _get_direct_message_store().send_message(thread_id, current_user_id, payload.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _dm_message_response(message, _dm_user_map(), current_user_id)


@app.post("/dm/threads/{thread_id}/read")
async def mark_direct_message_thread_read(thread_id: str, ctx: AuthContext = Depends(require_auth)):
    """Mark all messages in a thread as read for the current user."""
    current_user_id = _require_dm_user(ctx)
    _require_dm_thread_access(thread_id, current_user_id)
    changed = _get_direct_message_store().mark_read(thread_id, current_user_id)
    return {"status": "ok", "updated": changed}


@app.get("/auth/exchange-api-keys", response_model=ExchangeApiKeyBindingListResponse)
async def list_current_user_exchange_api_keys(ctx: AuthContext = Depends(require_auth)):
    """List the logged-in user's OKX/Binance API key bindings."""
    if ctx.user is None or ctx.user_id is None:
        raise HTTPException(status_code=401, detail="Login required")
    bindings = _get_auth_store().list_exchange_api_keys(ctx.user_id)
    return {"bindings": [binding.to_public_dict() for binding in bindings]}


@app.post(
    "/auth/exchange-api-keys",
    response_model=ExchangeApiKeyBindingResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_current_user_exchange_api_key(
    payload: CreateExchangeApiKeyBindingRequest,
    ctx: AuthContext = Depends(require_auth),
):
    """Create an OKX/Binance API key binding for the logged-in user."""
    if ctx.user is None or ctx.user_id is None:
        raise HTTPException(status_code=401, detail="Login required")
    if payload.exchange == "okx" and not payload.passphrase.strip():
        raise HTTPException(status_code=400, detail="OKX passphrase is required")
    binding = _get_auth_store().create_exchange_api_key(
        ctx.user_id,
        exchange=payload.exchange,
        label=payload.label,
        api_key=payload.api_key,
        api_secret=payload.api_secret,
        passphrase=payload.passphrase,
        product_type=payload.product_type,
        margin_mode=payload.margin_mode,
    )
    return binding.to_public_dict()


@app.delete("/auth/exchange-api-keys/{binding_id}")
async def delete_current_user_exchange_api_key(
    binding_id: int,
    ctx: AuthContext = Depends(require_auth),
):
    """Delete one API key binding owned by the logged-in user."""
    if ctx.user is None or ctx.user_id is None:
        raise HTTPException(status_code=401, detail="Login required")
    deleted = _get_auth_store().delete_exchange_api_key(ctx.user_id, binding_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="API key binding not found")
    return {"status": "deleted", "binding_id": binding_id}


@app.post("/auth/exchange-api-keys/{binding_id}/activate-live", response_model=CryptoLiveConfigureResponse)
async def activate_current_user_exchange_api_key(
    binding_id: int,
    check_connection: bool = False,
    ctx: AuthContext = Depends(require_auth),
):
    """Activate a saved exchange API key as the current live connector profile."""
    if ctx.user is None or ctx.user_id is None:
        raise HTTPException(status_code=401, detail="Login required")
    binding = _get_auth_store().get_exchange_api_key(ctx.user_id, binding_id)
    if binding is None:
        raise HTTPException(status_code=404, detail="API key binding not found")
    return _save_crypto_live_connector_config(
        exchange=binding.exchange,
        product_type=binding.product_type,
        api_key=binding.api_key,
        api_secret=binding.api_secret,
        passphrase=binding.passphrase,
        margin_mode=binding.margin_mode,
        check_connection=check_connection,
    )


@app.post("/auth/logout")
async def logout_user(
    ctx: AuthContext = Depends(require_auth),
    cred: Optional[HTTPAuthorizationCredentials] = Security(_security),
):
    """Revoke the current user token."""
    if ctx.user is None:
        return {"status": "ok"}
    token = cred.credentials if cred and cred.credentials else ""
    if token:
        _get_auth_store().revoke_token(token)
    return {"status": "ok"}


# ============================================================================
# Admin API
# ============================================================================


def _load_strategy_market_admin_items() -> list[StrategyMarketAdminItem]:
    if not STRATEGY_MARKET_ADMIN_PATH.exists():
        return []
    try:
        raw = json.loads(STRATEGY_MARKET_ADMIN_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.warning("Failed to read strategy market admin config", exc_info=True)
        return []
    items = raw.get("items") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []
    parsed: list[StrategyMarketAdminItem] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            parsed.append(StrategyMarketAdminItem(**item))
        except Exception:
            logger.warning("Skipping invalid strategy market admin item: %r", item)
    return parsed


def _public_strategy_admin_item(record: Any) -> StrategyMarketAdminItem:
    return StrategyMarketAdminItem(
        id=record.publicId,
        kind="community",
        enabled=record.reviewStatus == "published",
        featured=False,
        price="",
        status=record.reviewStatus,
        note=str(record.summary or "")[:500],
        updated_at=record.updatedAt,
        name=record.name,
        owner_user_id=record.ownerUserId,
        source_strategy_id=record.sourceStrategyId,
    )


def _load_strategy_market_admin_response_items() -> list[StrategyMarketAdminItem]:
    items = _load_strategy_market_admin_items()
    try:
        public_items = [_public_strategy_admin_item(record) for record in _get_strategy_store().list_all_public_strategies()]
    except RuntimeError:
        public_items = []
    return [*items, *public_items]


def _save_strategy_market_admin_items(items: list[StrategyMarketAdminItem]) -> list[StrategyMarketAdminItem]:
    now = datetime.utcnow().isoformat()
    deduped: dict[str, StrategyMarketAdminItem] = {}
    public_statuses: dict[str, str] = {}
    for item in items:
        if item.kind == "community":
            public_statuses[item.id] = "published" if item.enabled and item.status == "published" else item.status
            continue
        data = item.model_dump()
        data["updated_at"] = item.updated_at or now
        deduped[item.id] = StrategyMarketAdminItem(**data)
    ordered = sorted(deduped.values(), key=lambda item: (item.kind, item.id))
    payload = {"items": [item.model_dump() for item in ordered]}
    STRATEGY_MARKET_ADMIN_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if public_statuses:
        store = _get_strategy_store()
        for public_id, review_status in public_statuses.items():
            store.update_public_strategy_review_status(public_id, review_status)
    return _load_strategy_market_admin_response_items()


def _empty_admin_usage() -> dict[int | None, AdminUserUsageRow]:
    return {}


def _mysql_admin_usage_by_user() -> dict[int | None, AdminUserUsageRow]:
    from src.persistence import mysql_configured

    if not mysql_configured():
        return _empty_admin_usage()
    from src.persistence.mysql import mysql_connection

    usage: dict[int | None, AdminUserUsageRow] = {}
    try:
        with mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT user_id, COUNT(*) AS session_count, MAX(updated_at) AS last_session_at
                    FROM sessions
                    GROUP BY user_id
                    """
                )
                for row in cur.fetchall():
                    user_id = row.get("user_id")
                    key = int(user_id) if user_id is not None else None
                    usage[key] = AdminUserUsageRow(
                        user_id=key,
                        session_count=int(row.get("session_count") or 0),
                        last_session_at=str(row.get("last_session_at") or "") or None,
                    )

                cur.execute(
                    """
                    SELECT s.user_id, COUNT(m.message_id) AS message_count, MAX(m.created_at) AS last_message_at
                    FROM session_messages m
                    JOIN sessions s ON s.session_id = m.session_id
                    GROUP BY s.user_id
                    """
                )
                for row in cur.fetchall():
                    user_id = row.get("user_id")
                    key = int(user_id) if user_id is not None else None
                    entry = usage.setdefault(key, AdminUserUsageRow(user_id=key))
                    entry.message_count = int(row.get("message_count") or 0)
                    entry.last_message_at = str(row.get("last_message_at") or "") or None

                cur.execute(
                    """
                    SELECT
                        s.user_id,
                        COUNT(a.attempt_id) AS attempt_count,
                        SUM(CASE WHEN a.status = 'running' THEN 1 ELSE 0 END) AS running_count,
                        SUM(CASE WHEN a.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
                        SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed_count
                    FROM session_attempts a
                    JOIN sessions s ON s.session_id = a.session_id
                    GROUP BY s.user_id
                    """
                )
                for row in cur.fetchall():
                    user_id = row.get("user_id")
                    key = int(user_id) if user_id is not None else None
                    entry = usage.setdefault(key, AdminUserUsageRow(user_id=key))
                    entry.attempt_count = int(row.get("attempt_count") or 0)
                    entry.running_attempt_count = int(row.get("running_count") or 0)
                    entry.failed_attempt_count = int(row.get("failed_count") or 0)
                    entry.completed_attempt_count = int(row.get("completed_count") or 0)

                cur.execute(
                    """
                    SELECT user_id, COUNT(*) AS strategy_count
                    FROM strategy_library
                    GROUP BY user_id
                    """
                )
                for row in cur.fetchall():
                    user_id = row.get("user_id")
                    key = int(user_id) if user_id is not None else None
                    entry = usage.setdefault(key, AdminUserUsageRow(user_id=key))
                    entry.strategy_count = int(row.get("strategy_count") or 0)
    except Exception:
        logger.info("Admin MySQL usage statistics are unavailable; falling back to session files", exc_info=True)
        return _empty_admin_usage()
    return usage


def _filesystem_admin_usage_by_user() -> dict[int | None, AdminUserUsageRow]:
    svc = _get_session_service()
    if not svc:
        return {}
    usage: dict[int | None, AdminUserUsageRow] = {}
    for session in svc.list_sessions(limit=1000):
        key = session.owner_user_id
        entry = usage.setdefault(key, AdminUserUsageRow(user_id=key))
        entry.session_count += 1
        entry.last_session_at = max(filter(None, [entry.last_session_at, session.updated_at]), default=None)
        messages = svc.get_messages(session.session_id, limit=10000)
        entry.message_count += len(messages)
        if messages:
            entry.last_message_at = max(filter(None, [entry.last_message_at, messages[-1].created_at]), default=None)
        attempts_dir = SESSIONS_DIR / session.session_id / "attempts"
        if attempts_dir.exists():
            for attempt_file in attempts_dir.glob("*/attempt.json"):
                try:
                    data = json.loads(attempt_file.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                entry.attempt_count += 1
                status_value = str(data.get("status") or "")
                if status_value == "running":
                    entry.running_attempt_count += 1
                elif status_value == "failed":
                    entry.failed_attempt_count += 1
                elif status_value == "completed":
                    entry.completed_attempt_count += 1
    return usage


def _admin_usage_by_user() -> dict[int | None, AdminUserUsageRow]:
    usage = _mysql_admin_usage_by_user()
    if usage:
        return usage
    return _filesystem_admin_usage_by_user()


def _split_moderation_terms(value: str | None) -> list[str]:
    if not value:
        return []
    terms: list[str] = []
    for term in re.split(r"[\n,，;；]+", value):
        normalized = term.strip()
        if normalized and normalized not in terms:
            terms.append(normalized)
    return terms


def _matched_moderation_terms(content: str, terms: list[str]) -> list[str]:
    lowered = content.lower()
    return [term for term in terms if term.lower() in lowered]


def _admin_chat_message_from_parts(
    *,
    message: Any,
    session: Any,
    users_by_id: dict[int, Any],
    matched_terms: list[str],
    source: str = "agent_session",
) -> AdminChatMessageResponse:
    user_id = session.owner_user_id
    user = users_by_id.get(user_id) if user_id is not None else None
    return AdminChatMessageResponse(
        source=source,
        message_id=message.message_id,
        session_id=message.session_id,
        session_title=session.title,
        role=message.role,
        content=message.content,
        created_at=message.created_at,
        linked_attempt_id=message.linked_attempt_id,
        metadata=message.metadata if message.metadata else None,
        user_id=user_id,
        username=str(getattr(user, "username", "")) if user else ("operator" if user_id is None else f"user:{user_id}"),
        display_name=str(getattr(user, "display_name", "")) if user else ("Operator / local" if user_id is None else "Deleted user"),
        matched_terms=matched_terms,
    )


def _mysql_admin_chat_messages(
    *,
    limit: int,
    query: str,
    user_id: int | None,
    terms: list[str],
) -> tuple[list[AdminChatMessageResponse], int]:
    from src.persistence import mysql_configured

    if not mysql_configured():
        return [], 0
    from src.persistence.mysql import mysql_connection
    from src.session.models import Message, Session

    users_by_id = _dm_user_map()
    rows: list[dict[str, Any]] = []
    where: list[str] = []
    params: list[Any] = []
    if query:
        where.append("m.content LIKE %s")
        params.append(f"%{query}%")
    if user_id is not None:
        where.append("s.user_id = %s")
        params.append(int(user_id))
    sql = """
        SELECT
            m.message_id, m.session_id, m.role, m.content, m.created_at,
            m.linked_attempt_id, m.metadata_json,
            s.title AS session_title, s.status AS session_status,
            s.created_at AS session_created_at, s.updated_at AS session_updated_at,
            s.last_attempt_id, s.config_json, s.user_id
        FROM session_messages m
        JOIN sessions s ON s.session_id = m.session_id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY m.id DESC LIMIT %s"
    params.append(max(limit * 5 if terms else limit, limit))
    try:
        with mysql_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, tuple(params))
                rows = cur.fetchall()
    except Exception:
        logger.info("Admin MySQL chat moderation rows are unavailable", exc_info=True)
        return [], 0

    responses: list[AdminChatMessageResponse] = []
    for row in rows:
        config = row.get("config_json") or {}
        if isinstance(config, str):
            try:
                config = json.loads(config)
            except json.JSONDecodeError:
                config = {}
        if row.get("user_id") is not None:
            config = {**config, "user_id": row.get("user_id")}
        metadata = row.get("metadata_json") or {}
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except json.JSONDecodeError:
                metadata = {}
        message = Message(
            message_id=str(row.get("message_id") or ""),
            session_id=str(row.get("session_id") or ""),
            role=str(row.get("role") or ""),
            content=str(row.get("content") or ""),
            created_at=str(row.get("created_at") or ""),
            linked_attempt_id=row.get("linked_attempt_id"),
            metadata=metadata if isinstance(metadata, dict) else {},
        )
        session = Session(
            session_id=str(row.get("session_id") or ""),
            title=str(row.get("session_title") or ""),
            status=row.get("session_status") or "active",
            created_at=str(row.get("session_created_at") or ""),
            updated_at=str(row.get("session_updated_at") or ""),
            last_attempt_id=row.get("last_attempt_id"),
            config=config if isinstance(config, dict) else {},
        )
        matched_terms = _matched_moderation_terms(message.content, terms)
        if terms and not matched_terms:
            continue
        responses.append(
            _admin_chat_message_from_parts(
                message=message,
                session=session,
                users_by_id=users_by_id,
                matched_terms=matched_terms,
            )
        )
        if len(responses) >= limit:
            break
    return responses, len(rows)


def _filesystem_admin_chat_messages(
    *,
    limit: int,
    query: str,
    user_id: int | None,
    terms: list[str],
) -> tuple[list[AdminChatMessageResponse], int]:
    svc = _get_session_service()
    if not svc:
        return [], 0
    users_by_id = _dm_user_map()
    responses: list[AdminChatMessageResponse] = []
    scanned = 0
    for session in svc.list_sessions(limit=1000):
        if user_id is not None and session.owner_user_id != user_id:
            continue
        for message in reversed(svc.get_messages(session.session_id, limit=10000)):
            scanned += 1
            if query and query not in message.content:
                continue
            matched_terms = _matched_moderation_terms(message.content, terms)
            if terms and not matched_terms:
                continue
            responses.append(
                _admin_chat_message_from_parts(
                    message=message,
                    session=session,
                    users_by_id=users_by_id,
                    matched_terms=matched_terms,
                )
            )
    responses.sort(key=lambda row: row.created_at, reverse=True)
    return responses[:limit], scanned


def _admin_chat_messages(
    *,
    limit: int,
    query: str,
    user_id: int | None,
    terms: list[str],
) -> tuple[list[AdminChatMessageResponse], int]:
    messages, scanned = _mysql_admin_chat_messages(limit=limit, query=query, user_id=user_id, terms=terms)
    if not (messages or scanned):
        messages, scanned = _filesystem_admin_chat_messages(limit=limit, query=query, user_id=user_id, terms=terms)
    dm_messages, dm_scanned = _admin_direct_messages(limit=limit, query=query, user_id=user_id, terms=terms)
    combined = [*messages, *dm_messages]
    combined.sort(key=lambda row: row.created_at, reverse=True)
    return combined[:limit], scanned + dm_scanned


def _admin_direct_messages(
    *,
    limit: int,
    query: str,
    user_id: int | None,
    terms: list[str],
) -> tuple[list[AdminChatMessageResponse], int]:
    users_by_id = _dm_user_map()
    store = _get_direct_message_store()
    threads_by_id = {thread.thread_id: thread for thread in store.list_all_threads()}
    responses: list[AdminChatMessageResponse] = []
    scanned = 0
    scan_limit = limit * 5 if (terms or query or user_id is not None) else limit
    for message in store.list_all_messages(limit=max(scan_limit, limit)):
        scanned += 1
        thread = threads_by_id.get(message.thread_id)
        if user_id is not None:
            participant_ids = set(thread.participant_user_ids if thread is not None else [])
            if int(user_id) not in participant_ids:
                continue
        if query and query not in message.content:
            continue
        matched_terms = _matched_moderation_terms(message.content, terms)
        if terms and not matched_terms:
            continue
        sender = users_by_id.get(int(message.sender_user_id))
        role = "sender" if user_id is None or int(message.sender_user_id) == int(user_id) else "peer"
        peer_names: list[str] = []
        if thread is not None:
            for participant_id in thread.participant_user_ids:
                user = users_by_id.get(participant_id)
                peer_names.append(str(getattr(user, "display_name", "")) or str(getattr(user, "username", "")) or f"user:{participant_id}")
        session = type(
            "AdminDirectMessageSession",
            (),
            {
                "owner_user_id": int(message.sender_user_id),
                "title": "私信: " + " / ".join(peer_names) if peer_names else "私信",
            },
        )()
        wrapped = type(
            "AdminDirectMessage",
            (),
            {
                "message_id": message.message_id,
                "session_id": message.thread_id,
                "role": role,
                "content": message.content,
                "created_at": message.created_at,
                "linked_attempt_id": None,
                "metadata": {"thread_id": message.thread_id, "sender_user_id": message.sender_user_id},
            },
        )()
        if sender is None and int(message.sender_user_id) not in users_by_id:
            users_by_id[int(message.sender_user_id)] = type(
                "DeletedDirectMessageUser",
                (),
                {
                    "username": f"user:{message.sender_user_id}",
                    "display_name": "Deleted user",
                },
            )()
        responses.append(
            _admin_chat_message_from_parts(
                message=wrapped,
                session=session,
                users_by_id=users_by_id,
                matched_terms=matched_terms,
                source="direct_message",
            )
        )
        if len(responses) >= limit:
            break
    return responses, scanned


def _admin_summary(users: list[Any], usage_rows: list[AdminUserUsageRow]) -> AdminUsageSummary:
    return AdminUsageSummary(
        total_users=len(users),
        total_sessions=sum(row.session_count for row in usage_rows),
        total_messages=sum(row.message_count for row in usage_rows),
        total_attempts=sum(row.attempt_count for row in usage_rows),
        running_attempts=sum(row.running_attempt_count for row in usage_rows),
        failed_attempts=sum(row.failed_attempt_count for row in usage_rows),
        completed_attempts=sum(row.completed_attempt_count for row in usage_rows),
        total_strategies=sum(row.strategy_count for row in usage_rows),
    )


@app.get("/admin/dashboard", response_model=AdminDashboardResponse, dependencies=[Depends(require_operator_auth)])
async def get_admin_dashboard():
    """Return operator dashboard data for users, marketplace, and agent usage."""
    users = _get_auth_store().list_users(limit=500)
    users_by_id = {int(user.user_id): user for user in users}
    usage_map = _admin_usage_by_user()
    for user_id, user in users_by_id.items():
        row = usage_map.setdefault(user_id, AdminUserUsageRow(user_id=user_id))
        row.username = user.username
        row.display_name = user.display_name
    for row in usage_map.values():
        if row.user_id is None:
            row.username = "operator"
            row.display_name = "Operator / local"
        elif row.user_id not in users_by_id:
            row.username = f"user:{row.user_id}"
            row.display_name = "Deleted user"
    usage_rows = sorted(
        usage_map.values(),
        key=lambda row: (row.last_message_at or row.last_session_at or "", row.session_count),
        reverse=True,
    )
    return {
        "summary": _admin_summary(users, usage_rows),
        "users": [AuthUserResponse(**user.to_dict()) for user in users],
        "usage": usage_rows,
    }


@app.get(
    "/admin/chat-messages",
    response_model=AdminChatMessagesResponse,
    dependencies=[Depends(require_operator_auth)],
)
async def get_admin_chat_messages(
    limit: int = Query(200, ge=1, le=1000),
    q: str = Query("", max_length=200),
    user_id: Optional[int] = Query(None),
    sensitive_words: str = Query("", max_length=5000),
):
    """Return all recent chat messages visible to operators for moderation."""
    query = q.strip()
    terms = _split_moderation_terms(sensitive_words)
    messages, scanned = _admin_chat_messages(limit=limit, query=query, user_id=user_id, terms=terms)
    return {"messages": messages, "total": len(messages), "scanned": scanned}


@app.patch("/admin/users/{user_id}", response_model=AuthUserResponse, dependencies=[Depends(require_operator_auth)])
async def admin_update_user(user_id: int, payload: AdminUserUpdateRequest):
    """Update an application user as an operator."""
    user = _get_auth_store().update_user(
        user_id,
        display_name=payload.display_name,
        password=payload.password,
        revoke_tokens=payload.revoke_tokens,
    )
    if user is None:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found")
    return AuthUserResponse(**user.to_dict())


@app.delete("/admin/users/{user_id}", dependencies=[Depends(require_operator_auth)])
async def admin_delete_user(user_id: int):
    """Delete an application user as an operator."""
    deleted = _get_auth_store().delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found")
    return {"status": "deleted", "user_id": user_id}


@app.get("/strategy-market/catalog", response_model=StrategyMarketAdminResponse)
async def get_strategy_market_catalog_config():
    """Return public strategy market operator metadata."""
    return {"items": _load_strategy_market_admin_items()}


@app.get("/strategy-market/public", response_model=PublicStrategyMarketResponse)
async def list_public_strategy_market(ctx: AuthContext = Depends(require_auth)):
    """List user-published community strategy snapshots."""
    store = _get_strategy_store()
    return {"strategies": [item.to_dict() for item in store.list_public_strategies()]}


@app.get("/admin/strategy-market", response_model=StrategyMarketAdminResponse, dependencies=[Depends(require_operator_auth)])
async def get_admin_strategy_market():
    """Return operator-managed strategy market config."""
    return {"items": _load_strategy_market_admin_response_items()}


@app.put("/admin/strategy-market", response_model=StrategyMarketAdminResponse, dependencies=[Depends(require_operator_auth)])
async def update_admin_strategy_market(payload: StrategyMarketAdminUpdateRequest):
    """Replace operator-managed strategy market config."""
    return {"items": _save_strategy_market_admin_items(payload.items)}


# ============================================================================
# Workflow Factory
# ============================================================================

# ============================================================================
# Helper Functions
# ============================================================================

LLM_PROVIDER_CONFIG_PATH = AGENT_DIR / "src" / "providers" / "llm_providers.json"


def _load_llm_providers() -> List[LLMProviderOption]:
    """Load provider metadata from JSON so additions stay data-driven."""
    try:
        raw = json.loads(LLM_PROVIDER_CONFIG_PATH.read_text(encoding="utf-8"))
        providers = [LLMProviderOption(**item) for item in raw]
    except Exception as exc:
        raise RuntimeError(f"Failed to load LLM provider config: {LLM_PROVIDER_CONFIG_PATH}") from exc

    seen: set[str] = set()
    for provider in providers:
        if provider.name in seen:
            raise RuntimeError(f"Duplicate LLM provider name: {provider.name}")
        seen.add(provider.name)
    if not providers:
        raise RuntimeError("LLM provider config must not be empty")
    return providers


LLM_PROVIDERS = _load_llm_providers()
LLM_PROVIDER_BY_NAME = {provider.name: provider for provider in LLM_PROVIDERS}
LLM_REASONING_EFFORTS = {"", "low", "medium", "high", "max"}
LLM_API_KEY_PLACEHOLDERS = {"", "sk-or-v1-your-key-here", "sk-xxx", "xxx", "gsk_xxx"}
TUSHARE_TOKEN_PLACEHOLDERS = {"", "your-tushare-token"}


def _ensure_agent_env_file() -> Path:
    """Ensure the project-local agent/.env exists."""
    if not ENV_PATH.exists():
        ENV_PATH.write_text("# Created by Vibe-Trading Web UI settings.\n", encoding="utf-8")
    return ENV_PATH


def _strip_env_value(value: str) -> str:
    """Remove basic dotenv quotes and inline comments."""
    value = value.strip()
    if " #" in value:
        value = value.split(" #", 1)[0].rstrip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    return value.strip()


def _read_env_values(path: Path) -> Dict[str, str]:
    """Read active KEY=value entries from a dotenv file."""
    values: Dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key:
            values[key] = _strip_env_value(value)
    return values


def _read_settings_env_values() -> Dict[str, str]:
    """Read settings without creating agent/.env.

    Prefer the user's active agent/.env. If it does not exist yet, fall back to
    agent/.env.example for display defaults only.
    """
    if ENV_PATH.exists():
        return _read_env_values(ENV_PATH)
    if ENV_EXAMPLE_PATH.exists():
        return _read_env_values(ENV_EXAMPLE_PATH)
    return {}


def _project_relative_path(path: Path) -> str:
    """Return a project-relative display path without leaking an absolute path."""
    try:
        return path.resolve().relative_to(AGENT_DIR.parent.resolve()).as_posix()
    except ValueError:
        return path.name


def _format_env_value(value: str) -> str:
    """Format a dotenv value without allowing multiline injection."""
    if "\n" in value or "\r" in value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Environment values cannot contain newlines")
    value = value.strip()
    if not value:
        return ""
    if any(ch.isspace() for ch in value) or "#" in value:
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return value


def _write_env_values(path: Path, updates: Dict[str, str]) -> None:
    """Upsert active dotenv values while preserving comments and ordering."""
    _ensure_agent_env_file()
    lines = path.read_text(encoding="utf-8").splitlines()
    seen: set[str] = set()
    for index, raw in enumerate(lines):
        stripped = raw.lstrip()
        is_comment = stripped.startswith("#")
        candidate = stripped[1:].lstrip() if is_comment else stripped
        if "=" not in candidate:
            continue
        key = candidate.split("=", 1)[0].strip()
        if key in updates and key not in seen:
            lines[index] = f"{key}={_format_env_value(updates[key])}"
            seen.add(key)
    missing = [key for key in updates if key not in seen]
    if missing:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append("# Updated from Web UI")
        for key in missing:
            lines.append(f"{key}={_format_env_value(updates[key])}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _is_configured_secret(value: str, placeholders: set[str]) -> bool:
    """Return True when a secret is set and not a documented placeholder."""
    normalized = value.strip().strip('"').strip("'")
    if not normalized:
        return False
    return normalized.lower() not in {placeholder.lower() for placeholder in placeholders}


def _coerce_float(value: str, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_int(value: str, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _build_llm_settings_response(values: Optional[Dict[str, str]] = None) -> LLMSettingsResponse:
    """Build the public settings payload from dotenv values."""
    env_values = values if values is not None else _read_settings_env_values()
    provider_name = env_values.get("LANGCHAIN_PROVIDER", "openai").strip().lower()
    provider = LLM_PROVIDER_BY_NAME.get(provider_name, LLM_PROVIDER_BY_NAME["openai"])
    api_key = env_values.get(provider.api_key_env or "", "") if provider.api_key_env else ""
    api_key_configured = _is_configured_secret(api_key, LLM_API_KEY_PLACEHOLDERS)
    api_key_hint = None
    if provider.auth_type == "oauth":
        try:
            from src.providers.openai_codex import get_openai_codex_login_status

            token = get_openai_codex_login_status()
        except Exception:
            token = None
        api_key_configured = bool(token)
        api_key_hint = None
    return LLMSettingsResponse(
        provider=provider.name,
        model_name=env_values.get("LANGCHAIN_MODEL_NAME", provider.default_model),
        base_url=env_values.get(provider.base_url_env, provider.default_base_url),
        api_key_env=provider.api_key_env,
        api_key_configured=api_key_configured,
        api_key_hint=api_key_hint,
        api_key_required=provider.api_key_required,
        temperature=_coerce_float(env_values.get("LANGCHAIN_TEMPERATURE", "0.0"), 0.0),
        timeout_seconds=_coerce_int(env_values.get("TIMEOUT_SECONDS", "120"), 120),
        max_retries=_coerce_int(env_values.get("MAX_RETRIES", "2"), 2),
        reasoning_effort=env_values.get("LANGCHAIN_REASONING_EFFORT", "").strip().lower(),
        sse_timeout_seconds=_coerce_int(env_values.get("VIBE_TRADING_SSE_TIMEOUT", "90"), 90),
        env_path=_project_relative_path(ENV_PATH),
        providers=LLM_PROVIDERS,
    )


def _baostock_supported() -> bool:
    """Check whether the project has a BaoStock loader implementation."""
    loader_dir = AGENT_DIR / "backtest" / "loaders"
    return any((loader_dir / name).exists() for name in ("baostock.py", "baostock_loader.py"))


def _baostock_installed() -> bool:
    """Check whether the optional BaoStock package is importable."""
    import importlib.util

    return importlib.util.find_spec("baostock") is not None


def _build_data_source_settings_response(values: Optional[Dict[str, str]] = None) -> DataSourceSettingsResponse:
    """Build the public data source settings payload."""
    env_values = values if values is not None else _read_settings_env_values()
    token = env_values.get("TUSHARE_TOKEN", "")
    token_configured = _is_configured_secret(token, TUSHARE_TOKEN_PLACEHOLDERS)
    supported = _baostock_supported()
    installed = _baostock_installed()
    if supported:
        baostock_message = "BaoStock loader is available."
    elif installed:
        baostock_message = "BaoStock package is installed, but this project has no BaoStock loader."
    else:
        baostock_message = "No BaoStock loader is registered in this project."
    return DataSourceSettingsResponse(
        tushare_token_configured=token_configured,
        tushare_token_hint=None,
        baostock_supported=supported,
        baostock_installed=installed,
        baostock_message=baostock_message,
        env_path=_project_relative_path(ENV_PATH),
    )


def _sync_runtime_env(provider: LLMProviderOption, updates: Dict[str, str]) -> None:
    """Apply saved LLM settings to the running API process."""
    for key, value in updates.items():
        if value:
            os.environ[key] = value
        else:
            os.environ.pop(key, None)

    if provider.api_key_env:
        key_value = os.environ.get(provider.api_key_env, "")
        if _is_configured_secret(key_value, LLM_API_KEY_PLACEHOLDERS):
            os.environ["OPENAI_API_KEY"] = key_value
        else:
            os.environ.pop("OPENAI_API_KEY", None)
    elif provider.auth_type == "oauth":
        os.environ.pop("OPENAI_API_KEY", None)
    else:
        os.environ["OPENAI_API_KEY"] = "ollama"

    base_url = os.environ.get(provider.base_url_env, "")
    if base_url:
        os.environ["OPENAI_API_BASE"] = base_url
        os.environ["OPENAI_BASE_URL"] = base_url
    else:
        os.environ.pop("OPENAI_API_BASE", None)
        os.environ.pop("OPENAI_BASE_URL", None)


def _load_json_file(path: Path) -> Optional[Dict[str, Any]]:
    """Load JSON from disk if present."""
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return None


def _load_csv_to_dict(path: Path, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Load CSV rows into a list of dictionaries."""
    try:
        if not path.exists():
            return []
        with path.open("r", encoding="utf-8", newline="") as handle:
            rows = [dict(row) for row in csv.DictReader(handle)]
        if limit is not None:
            rows = rows[:limit]
        return rows
    except Exception:
        return []



def _build_response_from_run_dir(run_dir: Path, elapsed: float, *, include_analysis: bool = False) -> RunResponse:
    """Build a run response from a persisted run directory."""
    run_id = run_dir.name

    response = RunResponse(
        status="unknown",
        run_id=run_id,
        elapsed_seconds=elapsed,
        run_directory=str(run_dir),
    )

    state_data = _load_json_file(run_dir / "state.json")
    if state_data:
        state_status = str(state_data.get("status") or "").lower()
        if state_status == "success":
            response.status = "success"
        elif state_status == "failed":
            response.status = "failed"
            response.reason = state_data.get("reason", "")
        else:
            response.status = state_status or "unknown"
    else:
        response.status = "unknown"

    planner_path = run_dir / "planner_output.json"
    response.planner_output = _load_json_file(planner_path)

    design_path = run_dir / "design_spec.json"
    response.strategy_spec = _load_json_file(design_path)

    rag_path = run_dir / "rag_metadata.json"
    rag_data = _load_json_file(rag_path)
    if rag_data:
        response.rag_selection = RAGSelection(
            selected_api=rag_data.get("selected_api") or rag_data.get("api_code", ""),
            selected_name=rag_data.get("selected_name") or rag_data.get("api_name", ""),
            selected_score=float(rag_data.get("selected_score") or rag_data.get("score", 0.0)),
        )

    metrics_path = run_dir / "artifacts" / "metrics.csv"
    if metrics_path.exists():
        metrics_dict_list = _load_csv_to_dict(metrics_path, limit=1)
        if metrics_dict_list:
            row = metrics_dict_list[0]
            try:
                # Pass ALL CSV columns to BacktestMetrics (extra="allow")
                parsed: dict = {}
                for k, v in row.items():
                    if not k or not v:
                        continue
                    try:
                        parsed[k] = int(float(v)) if k == "trade_count" or k == "max_consecutive_loss" else float(v)
                    except (ValueError, TypeError):
                        continue
                if "final_value" in parsed:
                    response.metrics = BacktestMetrics(**parsed)
            except (ValueError, TypeError):
                pass


    artifacts_dir = run_dir / "artifacts"
    if artifacts_dir.exists():
        for file_path in artifacts_dir.iterdir():
            if file_path.is_file():
                file_type = file_path.suffix.lstrip(".")
                response.artifacts.append(
                    Artifact(
                        name=file_path.name,
                        path=str(file_path),
                        type=file_type if file_type else "unknown",
                        size=file_path.stat().st_size,
                        exists=True,
                    )
                )

    equity_path = run_dir / "artifacts" / "equity.csv"
    if equity_path.exists():
        response.artifacts_equity_csv = _load_csv_to_dict(equity_path)

    metrics_csv_path = run_dir / "artifacts" / "metrics.csv"
    if metrics_csv_path.exists():
        response.artifacts_metrics_csv = _load_csv_to_dict(metrics_csv_path)

    run_card_path = run_dir / "run_card.json"
    if run_card_path.exists():
        try:
            response.run_card = json.loads(run_card_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    trades_path = run_dir / "artifacts" / "trades.csv"
    if trades_path.exists():
        response.artifacts_trades_csv = _load_csv_to_dict(trades_path)

    validation_path = run_dir / "artifacts" / "validation.json"
    if validation_path.exists():
        try:
            response.validation = json.loads(validation_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    if response.artifacts_equity_csv:
        filtered_equity = []
        for row in response.artifacts_equity_csv[:1000]:
            filtered_row: Dict[str, Any] = {}
            if "timestamp" in row:
                filtered_row["time"] = row["timestamp"]
            if "equity" in row:
                filtered_row["equity"] = row["equity"]
            if "drawdown" in row:
                filtered_row["drawdown"] = row["drawdown"]
            filtered_equity.append(filtered_row)
        response.equity_curve = filtered_equity

    if response.artifacts_trades_csv:
        response.trade_log = response.artifacts_trades_csv[:500]

    if include_analysis:
        analysis = build_run_analysis(run_dir)
        response.run_stage = analysis.get("run_stage")
        response.run_context = analysis.get("run_context")
        response.price_series = analysis.get("price_series")
        response.indicator_series = analysis.get("indicator_series")
        response.trade_markers = analysis.get("trade_markers")
        response.run_logs = analysis.get("run_logs")

    return response


# ============================================================================
# Path-parameter validation
# ============================================================================

# ``run_id`` and ``session_id`` flow directly into filesystem paths
# (``RUNS_DIR / run_id`` etc.). Restrict to a safe character class so that
# values like ``..`` or ``foo/../bar`` cannot escape the parent directory.
_SAFE_PATH_PARAM_RE = __import__("re").compile(r"^[A-Za-z0-9_-]{1,128}$")


def _validate_path_param(value: str, kind: str) -> None:
    """Reject path parameters that could escape the parent directory.

    Args:
        value: User-supplied path-parameter value.
        kind: Parameter name, used in the error detail.

    Raises:
        HTTPException: 400 when ``value`` does not match the safe character
            class, mirroring the existing ``_SHADOW_ID_RE`` check.
    """
    if not _SAFE_PATH_PARAM_RE.fullmatch(value or ""):
        raise HTTPException(status_code=400, detail=f"invalid {kind}")


def _session_belongs_to_context(session: Any, ctx: AuthContext) -> bool:
    """Return whether a session is visible to the current auth context."""
    if ctx.operator:
        return True
    if ctx.user_id is None:
        return False
    return getattr(session, "owner_user_id", None) == ctx.user_id


def _require_user_session(session_id: str, ctx: AuthContext):
    """Load a session and enforce app-user ownership."""
    svc, session = _get_existing_session_or_404(session_id)
    if not _session_belongs_to_context(session, ctx):
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return svc, session


def _session_id_from_run_dir(run_dir: Path) -> str | None:
    req = _load_json_file(run_dir / "req.json") or {}
    context = req.get("context") if isinstance(req, dict) else None
    if isinstance(context, dict):
        value = str(context.get("session_id") or "").strip()
        return value or None
    return None


def _run_belongs_to_context(run_dir: Path, ctx: AuthContext) -> bool:
    if ctx.operator:
        return True
    if ctx.user_id is None:
        return False
    req = _load_json_file(run_dir / "req.json") or {}
    context = req.get("context") if isinstance(req, dict) else None
    if isinstance(context, dict):
        owner_user_id = context.get("user_id")
        try:
            if owner_user_id is not None and int(owner_user_id) == ctx.user_id:
                return True
        except (TypeError, ValueError):
            pass
    session_id = _session_id_from_run_dir(run_dir)
    if not session_id:
        return False
    try:
        svc, session = _get_existing_session_or_404(session_id)
    except HTTPException:
        return False
    return _session_belongs_to_context(session, ctx)


def _require_run_access(run_id: str, ctx: AuthContext) -> Path:
    _validate_path_param(run_id, "run_id")
    run_dir = RUNS_DIR / run_id
    if not run_dir.exists() or not _run_belongs_to_context(run_dir, ctx):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")
    return run_dir


def _swarm_run_belongs_to_context(run: Any, ctx: AuthContext) -> bool:
    if ctx.operator:
        return True
    if ctx.user_id is None:
        return False
    owner_user_id = getattr(run, "owner_user_id", None)
    if owner_user_id is not None:
        try:
            return int(owner_user_id) == ctx.user_id
        except (TypeError, ValueError):
            return False
    owner_session_id = getattr(run, "owner_session_id", None)
    if owner_session_id:
        try:
            _svc, session = _get_existing_session_or_404(str(owner_session_id))
        except HTTPException:
            return False
        return _session_belongs_to_context(session, ctx)
    return False


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/runs/{run_id}/code")
async def get_run_code(run_id: str, ctx: AuthContext = Depends(require_auth)):
    """Return strategy source files for a run.

    Args:
        run_id: Run identifier.

    Returns:
        Map filename -> source text.
    """
    run_dir = _require_run_access(run_id, ctx) / "code"
    if not run_dir.exists():
        raise HTTPException(status_code=404, detail=f"Code directory for run {run_id} not found")
    result = {}
    for f in ["signal_engine.py"]:
        p = run_dir / f
        if p.exists():
            result[f] = p.read_text(encoding="utf-8")
    return result


@app.get("/runs/{run_id}/pine")
async def get_run_pine(run_id: str, ctx: AuthContext = Depends(require_auth)):
    """Return Pine Script file for a run.

    Args:
        run_id: Run identifier.

    Returns:
        Object with pine script content and exists flag.
    """
    pine_path = _require_run_access(run_id, ctx) / "artifacts" / "strategy.pine"
    if not pine_path.exists():
        return {"exists": False, "content": None}
    return {
        "exists": True,
        "content": pine_path.read_text(encoding="utf-8"),
    }


@app.get("/runs/{run_id}", response_model=RunResponse)
async def get_run_result(run_id: str, ctx: AuthContext = Depends(require_auth)):
    """Fetch full details for a historical run by ``run_id``."""
    run_dir = _require_run_access(run_id, ctx)

    response = _build_response_from_run_dir(run_dir, elapsed=0.0, include_analysis=True)

    return response


@app.get("/runs", response_model=List[RunInfo])
async def list_runs(limit: int = 20, ctx: AuthContext = Depends(require_auth)):
    """List recent runs with summary fields."""
    limit = min(max(1, limit), 100)
    runs_dir = RUNS_DIR

    if not runs_dir.exists():
        return []

    run_dirs = sorted(
        [d for d in runs_dir.iterdir() if d.is_dir()],
        key=lambda x: x.name,
        reverse=True
    )

    results = []
    for d in run_dirs:
        if len(results) >= limit:
            break
        if not _run_belongs_to_context(d, ctx):
            continue
        run_id = d.name

        # Status from state.json or artifacts
        status_val = "unknown"
        state_file = _load_json_file(d / "state.json")
        if state_file:
            status_val = str(state_file.get("status") or "unknown").lower()
        elif (d / "artifacts" / "equity.csv").exists():
            status_val = "success"
        elif (d / "review_report.json").exists():
            status_val = "success"

        # Parse created_at from run_id (YYYYMMDD_HHMMSS or run_YYYYMMDD_HHMMSS)
        created_at = "Unknown"
        if run_id.startswith("run_"):
            parts = run_id.split('_')
            if len(parts) >= 3:
                d_str, t_str = parts[1], parts[2]
                if len(d_str) == 8 and len(t_str) == 6:
                    created_at = f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:8]} {t_str[:2]}:{t_str[2:4]}:{t_str[4:6]}"
        elif "_" in run_id:
            parts = run_id.split('_')
            if len(parts) >= 2:
                d_str, t_str = parts[0], parts[1]
                if len(d_str) == 8 and len(t_str) == 6:
                    created_at = f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:8]} {t_str[:2]}:{t_str[2:4]}:{t_str[4:6]}"

        if created_at == "Unknown":
            mtime = datetime.fromtimestamp(d.stat().st_mtime)
            created_at = mtime.strftime("%Y-%m-%d %H:%M:%S")

        prompt = None
        req_file = d / "req.json"
        planner_file = d / "planner_output.json"
        if req_file.exists():
            try:
                req_data = json.loads(req_file.read_text(encoding="utf-8"))
                prompt = req_data.get("prompt")
            except (json.JSONDecodeError, OSError):
                pass

        if not prompt and planner_file.exists():
            try:
                planner_data = json.loads(planner_file.read_text(encoding="utf-8"))
                prompt = planner_data.get("user_goal") or planner_data.get("goal")
            except (json.JSONDecodeError, OSError):
                pass

        if not prompt:
            prompt_file = d / "user_prompt.txt"
            if prompt_file.exists():
                prompt = prompt_file.read_text(encoding="utf-8").strip()

        total_return = None
        sharpe = None
        metrics_file = d / "artifacts" / "metrics.csv"
        if metrics_file.exists():
            try:
                import csv
                with open(metrics_file, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        total_return = float(row.get('total_return', 0) or 0)
                        sharpe = float(row.get('sharpe', 0) or 0)
                        break
            except (OSError, ValueError):
                pass

        run_context = load_run_context(d)
        results.append(RunInfo(
            run_id=run_id,
            status=status_val,
            created_at=created_at,
            prompt=prompt or "Manual Analysis",
            total_return=total_return,
            sharpe=sharpe,
            codes=run_context.get("codes") or [],
            start_date=run_context.get("start_date"),
            end_date=run_context.get("end_date"),
        ))

    return results


@app.get(
    "/settings/llm",
    response_model=LLMSettingsResponse,
    dependencies=[Depends(require_local_or_auth)],
)
async def get_llm_settings():
    """Return project-local LLM settings for the Web UI."""
    return _build_llm_settings_response()


@app.put("/settings/llm", response_model=LLMSettingsResponse, dependencies=[Depends(require_local_or_auth)])
async def update_llm_settings(payload: UpdateLLMSettingsRequest):
    """Persist project-local LLM settings and update the running process."""
    provider_name = payload.provider.strip().lower()
    provider = LLM_PROVIDER_BY_NAME.get(provider_name)
    if provider is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported LLM provider")

    model_name = payload.model_name.strip()
    if not model_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Model name is required")

    if payload.temperature < 0 or payload.temperature > 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Temperature must be between 0 and 2")

    reasoning_effort = (payload.reasoning_effort or "").strip().lower()
    if reasoning_effort not in LLM_REASONING_EFFORTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reasoning effort must be low, medium, high, or max")

    current_values = _read_settings_env_values()
    base_url = (payload.base_url if payload.base_url is not None else provider.default_base_url).strip()
    if provider.auth_type == "oauth":
        try:
            from src.providers.openai_codex import validate_codex_base_url

            base_url = validate_codex_base_url(base_url)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    updates: Dict[str, str] = {
        "LANGCHAIN_PROVIDER": provider.name,
        "LANGCHAIN_MODEL_NAME": model_name,
        provider.base_url_env: base_url,
        "LANGCHAIN_TEMPERATURE": str(payload.temperature),
        "TIMEOUT_SECONDS": str(payload.timeout_seconds),
        "MAX_RETRIES": str(payload.max_retries),
    }
    if reasoning_effort or "LANGCHAIN_REASONING_EFFORT" in current_values:
        updates["LANGCHAIN_REASONING_EFFORT"] = reasoning_effort

    if provider.api_key_env:
        if payload.clear_api_key:
            updates[provider.api_key_env] = ""
        elif payload.api_key is not None and payload.api_key.strip():
            api_key = payload.api_key.strip()
            updates[provider.api_key_env] = api_key if _is_configured_secret(api_key, LLM_API_KEY_PLACEHOLDERS) else ""
        elif provider.api_key_env in current_values and _is_configured_secret(
            current_values[provider.api_key_env],
            LLM_API_KEY_PLACEHOLDERS,
        ):
            updates[provider.api_key_env] = current_values[provider.api_key_env]
    elif payload.clear_api_key:
        os.environ.pop("OPENAI_API_KEY", None)

    _write_env_values(ENV_PATH, updates)
    _sync_runtime_env(provider, updates)
    return _build_llm_settings_response(_read_env_values(ENV_PATH))


@app.get(
    "/settings/data-sources",
    response_model=DataSourceSettingsResponse,
    dependencies=[Depends(require_local_or_auth)],
)
async def get_data_source_settings():
    """Return project-local data source credentials for the Web UI."""
    return _build_data_source_settings_response()


@app.put(
    "/settings/data-sources",
    response_model=DataSourceSettingsResponse,
    dependencies=[Depends(require_local_or_auth)],
)
async def update_data_source_settings(payload: UpdateDataSourceSettingsRequest):
    """Persist project-local data source credentials and update the running process."""
    current_values = _read_settings_env_values()
    updates: Dict[str, str] = {}

    if payload.clear_tushare_token:
        updates["TUSHARE_TOKEN"] = ""
    elif payload.tushare_token is not None and payload.tushare_token.strip():
        updates["TUSHARE_TOKEN"] = payload.tushare_token.strip()
    elif "TUSHARE_TOKEN" in current_values:
        updates["TUSHARE_TOKEN"] = current_values["TUSHARE_TOKEN"]

    if updates:
        _write_env_values(ENV_PATH, updates)
        token = updates.get("TUSHARE_TOKEN", "").strip()
        if _is_configured_secret(token, TUSHARE_TOKEN_PLACEHOLDERS):
            os.environ["TUSHARE_TOKEN"] = token
        else:
            os.environ.pop("TUSHARE_TOKEN", None)

    return _build_data_source_settings_response(_read_env_values(ENV_PATH))


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Liveness probe."""
    return HealthResponse(
        status="healthy",
        service="Vibe-Trading API",
        timestamp=datetime.now().isoformat()
    )


@app.get(
    "/crypto/markets",
    response_model=CryptoMarketsResponse,
    dependencies=[Depends(require_local_or_auth)],
)
async def get_crypto_markets(
    limit: int = Query(13, description="Number of mainstream crypto rows to return", ge=1, le=100),
):
    """Return dashboard crypto market rows and aggregate metrics."""
    from src.crypto_market import get_market_dashboard

    return get_market_dashboard(limit=limit)


def _shadow_user_id(ctx: AuthContext) -> str:
    """Resolve the isolated virtual-account key for the current caller."""
    if ctx.user_id is not None:
        return f"user:{ctx.user_id}"
    return "operator"


def _parse_shadow_side(value: str):
    from src.shadow_trading import OrderSide, ShadowTradingError

    clean = (value or "").strip().upper()
    try:
        return OrderSide(clean)
    except ValueError as exc:
        raise ShadowTradingError("side must be BUY or SELL") from exc


def _parse_shadow_order_type(value: str):
    from src.shadow_trading import OrderType, ShadowTradingError

    clean = (value or "MARKET").strip().upper()
    try:
        return OrderType(clean)
    except ValueError as exc:
        raise ShadowTradingError("order_type must be MARKET, LIMIT, or TRIGGER") from exc


def _parse_shadow_time_in_force(value: str):
    from src.shadow_trading import ShadowTradingError, TimeInForce

    clean = (value or "GTC").strip().upper()
    try:
        return TimeInForce(clean)
    except ValueError as exc:
        raise ShadowTradingError("time_in_force must be GTC, IOC, FOK, or POST_ONLY") from exc


def _parse_shadow_trigger_condition(value: str):
    from src.shadow_trading import ShadowTradingError, TriggerCondition

    clean = (value or "").strip().upper()
    if not clean:
        return None
    try:
        return TriggerCondition(clean)
    except ValueError as exc:
        raise ShadowTradingError("trigger_condition must be GTE or LTE") from exc


def _shadow_http_error(exc: Exception) -> HTTPException:
    message = str(exc) or "shadow trading request failed"
    not_found = "not found" in message.lower()
    return HTTPException(status_code=404 if not_found else 400, detail=message)


@app.get("/shadow/account", response_model=ShadowAccountResponse)
async def get_shadow_account(ctx: AuthContext = Depends(require_auth)):
    """Return the caller's isolated virtual trading account."""
    from src.shadow_trading import ShadowTradingError, shadow_trading_service

    try:
        return await shadow_trading_service.account_snapshot(_shadow_user_id(ctx))
    except ShadowTradingError as exc:
        raise _shadow_http_error(exc) from exc


@app.get("/shadow/orders", response_model=List[ShadowOrderResponse])
async def list_shadow_orders(ctx: AuthContext = Depends(require_auth)):
    """List virtual orders for the caller."""
    from src.shadow_trading import shadow_trading_service

    return [order.to_dict() for order in await shadow_trading_service.list_orders(_shadow_user_id(ctx))]


@app.post("/shadow/orders", response_model=ShadowOrderResponse)
async def place_shadow_order(payload: ShadowPlaceOrderRequest, ctx: AuthContext = Depends(require_auth)):
    """Place a virtual market or limit order against the shadow ledger."""
    from src.shadow_trading import AccountType, ShadowTradingError, shadow_trading_service

    try:
        order = await shadow_trading_service.place_order(
            user_id=_shadow_user_id(ctx),
            account_type=AccountType.VIRTUAL,
            symbol=payload.symbol,
            side=_parse_shadow_side(payload.side),
            order_type=_parse_shadow_order_type(payload.order_type),
            quantity=payload.quantity,
            price=payload.price,
            time_in_force=_parse_shadow_time_in_force(payload.time_in_force),
            trigger_price=payload.trigger_price,
            trigger_condition=_parse_shadow_trigger_condition(payload.trigger_condition),
            trigger_order_type=_parse_shadow_order_type(payload.trigger_order_type),
            trigger_order_price=payload.trigger_order_price,
        )
        return order.to_dict()
    except ShadowTradingError as exc:
        raise _shadow_http_error(exc) from exc


@app.post("/shadow/orders/{order_id}/cancel", response_model=ShadowOrderResponse)
async def cancel_shadow_order(order_id: str, ctx: AuthContext = Depends(require_auth)):
    """Cancel a pending virtual limit order and release frozen funds."""
    from src.shadow_trading import ShadowTradingError, shadow_trading_service

    try:
        order = await shadow_trading_service.cancel_order(_shadow_user_id(ctx), order_id)
        return order.to_dict()
    except ShadowTradingError as exc:
        raise _shadow_http_error(exc) from exc


@app.post("/shadow/market-price", response_model=ShadowPriceUpdateResponse)
async def update_shadow_market_price(payload: ShadowPriceUpdateRequest, ctx: AuthContext = Depends(require_auth)):
    """Update latest price and trigger eligible virtual limit orders."""
    from src.shadow_trading import ShadowTradingError, normalize_symbol, shadow_trading_service

    user_id = _shadow_user_id(ctx)
    try:
        filled_orders = await shadow_trading_service.update_market_price(payload.symbol, payload.price, user_id=user_id)
        return {
            "symbol": normalize_symbol(payload.symbol),
            "price": payload.price,
            "filled_orders": [order.to_dict() for order in filled_orders],
            "account": await shadow_trading_service.account_snapshot(user_id),
        }
    except ShadowTradingError as exc:
        raise _shadow_http_error(exc) from exc


@app.post("/shadow/reset", response_model=ShadowAccountResponse)
async def reset_shadow_account(ctx: AuthContext = Depends(require_auth)):
    """Reset the caller's virtual account to its initial ledger state."""
    from src.shadow_trading import shadow_trading_service

    user_id = _shadow_user_id(ctx)
    await shadow_trading_service.reset_user(user_id)
    return await shadow_trading_service.account_snapshot(user_id)


@app.get(
    "/crypto/klines",
    response_model=CryptoKlinesResponse,
    dependencies=[Depends(require_local_or_auth)],
)
async def get_crypto_klines(
    symbol: str = Query("BTC/USDT", description="Crypto symbol, e.g. BTC/USDT"),
    timeframe: str = Query("1h", description="Bar size: 1m, 5m, 15m, 30m, 1h, 4h, 1d"),
    limit: int = Query(180, description="Maximum bars to return", ge=20, le=1000),
):
    """Return normalized OHLCV K-line bars for the dashboard chart."""
    from src.crypto_market import get_klines

    try:
        return get_klines(symbol=symbol, timeframe=timeframe, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/correlation")
async def get_correlation_matrix(
    codes: str = Query(..., description="Comma-separated asset codes, e.g. BTC-USDT,ETH-USDT,SPY"),
    days: int = Query(90, description="Lookback window in days", ge=7, le=365),
    method: str = Query("pearson", description="Correlation method: pearson or spearman"),
):
    """Compute cross-asset correlation matrix from daily returns.

    Fetches price data for each code via available data loaders,
    computes pairwise correlation of daily returns over the lookback window.
    """
    from backtest.correlation import compute_correlation_matrix

    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    if len(code_list) < 2:
        raise HTTPException(status_code=400, detail="At least 2 asset codes required")
    if len(code_list) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 assets per request")
    if method not in ("pearson", "spearman"):
        raise HTTPException(status_code=400, detail="method must be 'pearson' or 'spearman'")

    try:
        result = compute_correlation_matrix(codes=code_list, days=days, method=method)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Correlation computation failed: {exc}")


def _terminate_current_process() -> None:
    """Stop the current API process after the response has been sent."""
    time.sleep(0.25)
    os.kill(os.getpid(), signal.SIGTERM)


@app.post("/system/shutdown", dependencies=[Depends(require_operator_auth)])
async def shutdown_local_api(background_tasks: BackgroundTasks, request: Request):
    """Shut down the local API server when requested from loopback clients."""
    client_host = request.client.host if request.client else ""
    if client_host not in {"127.0.0.1", "::1", "localhost"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Local access only")

    background_tasks.add_task(_terminate_current_process)
    return {
        "status": "shutting-down",
        "service": "Vibe-Trading API",
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/skills")
async def list_skills():
    """List registered skills (name and description)."""
    from src.agent.skills import SkillsLoader

    loader = SkillsLoader()
    return [
        {
            "name": s.name,
            "description": s.description,
        }
        for s in loader.skills
    ]


@app.get("/api")
async def api_info():
    """Service metadata."""
    return {
        "service": "Vibe-Trading API",
        "version": "5.0.0",
        "docs": "/docs",
        "health": "/health",
    }


# ============================================================================
# Session API
# ============================================================================

_session_service = None
_goal_store = None


def _get_session_service():
    """Lazy-init session service when ENABLE_SESSION_RUNTIME=true."""
    global _session_service
    if _session_service is not None:
        return _session_service

    if os.getenv("ENABLE_SESSION_RUNTIME", "true").lower() != "true":
        return None

    import asyncio
    from src.session.events import EventBus
    from src.session.factory import create_session_store
    from src.session.service import SessionService

    store = create_session_store(base_dir=SESSIONS_DIR)
    event_bus = EventBus()

    try:
        loop = asyncio.get_event_loop()
        event_bus.set_loop(loop)
    except RuntimeError:
        pass

    _session_service = SessionService(
        store=store,
        event_bus=event_bus,
        runs_dir=RUNS_DIR,
    )
    return _session_service


def _get_goal_store():
    """Return the shared finance goal store."""
    global _goal_store
    if _goal_store is None:
        from src.goal import create_goal_store

        _goal_store = create_goal_store()
    return _goal_store


def _get_existing_session_or_404(session_id: str):
    svc = _get_session_service()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    session = svc.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    return svc, session


# ============================================================================
# Strategy Library API
# ============================================================================

_strategy_store = None
_paper_store = None
_paper_service = None


def _get_strategy_store():
    """Return the shared strategy library store when MySQL is configured."""
    from src.persistence import mysql_configured

    if not mysql_configured():
        raise HTTPException(status_code=501, detail="Strategy library persistence requires MySQL")
    global _strategy_store
    if _strategy_store is None:
        from src.strategies import MySQLStrategyStore

        _strategy_store = MySQLStrategyStore()
    return _strategy_store


def _paper_user_id(ctx: AuthContext) -> int:
    """Resolve a stable owner id for paper deployments."""
    return int(ctx.user_id) if ctx.user_id is not None else 0


def _get_paper_store():
    """Return the shared paper deployment store."""
    global _paper_store
    if _paper_store is None:
        from src.paper_trading import SQLitePaperTradingStore

        _paper_store = SQLitePaperTradingStore()
    return _paper_store


def _get_paper_service():
    """Return the shared paper deployment service."""
    global _paper_service
    if _paper_service is None:
        from src.paper_trading import PaperTradingService
        from src.shadow_trading import shadow_trading_service

        _paper_service = PaperTradingService(
            store=_get_paper_store(),
            strategy_store=_get_strategy_store(),
            shadow_service=shadow_trading_service,
            shadow_user_resolver=lambda user_id: "operator" if int(user_id) == 0 else f"user:{int(user_id)}",
        )
    return _paper_service


def _paper_http_error(exc: Exception) -> HTTPException:
    message = str(exc) or "paper deployment request failed"
    status_code = 404 if "not found" in message.lower() else 400
    return HTTPException(status_code=status_code, detail=message)


_MARKET_BACKTEST_INTERVALS = {"1m", "5m", "15m", "30m", "1H", "4H", "1D"}
_MARKET_BACKTEST_IDS = {
    "crypto-trend-momentum",
    "crypto-perp-funding-carry",
    "crypto-cross-exchange-spread",
    "crypto-stat-arb-pairs",
    "crypto-vol-target-rotation",
    "crypto-event-driven-risk",
    "professional-grid-trading",
    "classic-turtle-trading",
}


def _market_backtest_strategy_config(strategy_id: str) -> Dict[str, Any]:
    configs: Dict[str, Dict[str, Any]] = {
        "crypto-trend-momentum": {
            "codes": ["BTC-USDT"],
            "interval": "4H",
            "engine_name": "real_crypto_trend_momentum_v1",
            "assumptions": [
                "OKX public OHLCV candles",
                "20/60 EMA trend filter",
                "55-bar Donchian breakout",
                "taker/maker fees and slippage applied by CryptoEngine",
            ],
        },
        "crypto-perp-funding-carry": {
            "codes": ["BTC-USDT"],
            "interval": "4H",
            "engine_name": "real_crypto_funding_proxy_v1",
            "assumptions": [
                "OKX public OHLCV candles",
                "price-momentum proxy because funding-rate history is not wired yet",
                "CryptoEngine applies a fixed funding_rate from config",
            ],
            "warnings": ["Funding-rate history is not connected yet; this is a real-price proxy backtest, not a full carry PnL attribution."],
            "funding_rate": 0.00005,
        },
        "crypto-cross-exchange-spread": {
            "codes": ["ETH-USDT"],
            "interval": "15m",
            "engine_name": "real_crypto_spread_proxy_v1",
            "assumptions": [
                "OKX public OHLCV candles",
                "intrabar range proxy for executable spread",
                "taker/maker fees and slippage applied by CryptoEngine",
            ],
            "warnings": ["Multi-exchange order book history is not connected yet; this is a real-price spread proxy backtest."],
        },
        "crypto-stat-arb-pairs": {
            "codes": ["ETH-USDT", "SOL-USDT"],
            "interval": "1H",
            "engine_name": "real_crypto_stat_arb_pairs_v1",
            "assumptions": [
                "OKX public OHLCV candles",
                "ETH/SOL rolling beta",
                "z-score entry/exit",
                "gross exposure normalized by BaseEngine",
            ],
        },
        "crypto-vol-target-rotation": {
            "codes": ["BTC-USDT", "ETH-USDT"],
            "interval": "1D",
            "engine_name": "real_crypto_vol_target_rotation_v1",
            "assumptions": [
                "OKX public OHLCV candles",
                "30-day realized volatility target",
                "BTC/ETH/cash rotation",
                "weekly signal persistence through shifted target weights",
            ],
        },
        "crypto-event-driven-risk": {
            "codes": ["BTC-USDT"],
            "interval": "4H",
            "engine_name": "real_crypto_event_risk_proxy_v1",
            "assumptions": [
                "OKX public OHLCV candles",
                "volume spike proxy for event confirmation",
                "ATR breakout and volatility invalidation",
            ],
            "warnings": ["External event calendar is not connected yet; this uses real volume/price event proxies."],
        },
        "professional-grid-trading": {
            "codes": ["BTC-USDT"],
            "interval": "1H",
            "engine_name": "real_professional_grid_v1",
            "assumptions": [
                "OKX public OHLCV candles",
                "range grid proxy around 54k-76k",
                "volatility pause and stop-loss guardrails",
            ],
        },
        "classic-turtle-trading": {
            "codes": ["BTC-USDT"],
            "interval": "4H",
            "engine_name": "real_classic_turtle_v1",
            "assumptions": [
                "OKX public OHLCV candles",
                "20/10 and 55/20 Donchian breakout systems",
                "20-bar ATR risk unit sizing",
                "0.5ATR pyramiding with 2ATR protective stop",
                "12% strategy drawdown pause for new entries",
            ],
        },
    }
    if strategy_id not in configs:
        raise HTTPException(status_code=404, detail=f"market strategy {strategy_id!r} is not supported for real backtest")
    return configs[strategy_id]


def _market_signal_engine_code(strategy_id: str) -> str:
    engines: Dict[str, str] = {
        "crypto-trend-momentum": '''import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        out = {}
        for code, df in data_map.items():
            close = df["close"]
            high = df["high"]
            volume = df.get("volume", pd.Series(0.0, index=df.index))
            fast = close.ewm(span=20, adjust=False).mean()
            slow = close.ewm(span=60, adjust=False).mean()
            breakout = close > high.rolling(55, min_periods=20).max().shift(1)
            vol_ok = close.pct_change().rolling(20, min_periods=10).std() * 100 < 6.5
            volume_ok = volume > volume.rolling(20, min_periods=10).mean()
            trend = (fast > slow) & (breakout | volume_ok) & vol_ok
            exit_signal = (fast < slow) | (~vol_ok)
            signal = pd.Series(0.0, index=df.index)
            signal.loc[trend] = 1.0
            signal.loc[exit_signal] = 0.0
            signal = signal.replace(0.0, pd.NA).ffill().fillna(0.0).clip(0.0, 1.0)
            out[code] = signal
        return out
''',
        "crypto-perp-funding-carry": '''import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        out = {}
        for code, df in data_map.items():
            close = df["close"]
            ret = close.pct_change()
            carry_proxy = ret.rolling(18, min_periods=8).mean() - ret.rolling(72, min_periods=24).mean()
            vol = ret.rolling(48, min_periods=12).std()
            signal = pd.Series(0.0, index=df.index)
            signal.loc[(carry_proxy > 0) & (vol < vol.rolling(96, min_periods=24).median() * 1.6)] = 1.0
            signal.loc[carry_proxy < 0] = -1.0
            out[code] = signal.replace(0.0, pd.NA).ffill().fillna(0.0).clip(-1.0, 1.0)
        return out
''',
        "crypto-cross-exchange-spread": '''import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        out = {}
        for code, df in data_map.items():
            close = df["close"]
            intrabar_edge = (df["high"] - df["low"]) / close
            mean_edge = intrabar_edge.rolling(96, min_periods=24).mean()
            ret = close.pct_change()
            signal = pd.Series(0.0, index=df.index)
            signal.loc[(intrabar_edge > mean_edge * 1.4) & (ret > 0)] = 1.0
            signal.loc[(intrabar_edge > mean_edge * 1.4) & (ret < 0)] = -1.0
            signal.loc[intrabar_edge <= mean_edge] = 0.0
            out[code] = signal.fillna(0.0).clip(-1.0, 1.0)
        return out
''',
        "crypto-stat-arb-pairs": '''import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        codes = list(data_map)
        out = {code: pd.Series(0.0, index=df.index) for code, df in data_map.items()}
        if len(codes) < 2:
            return out
        a, b = codes[0], codes[1]
        ca = data_map[a]["close"]
        cb = data_map[b]["close"].reindex(ca.index).ffill()
        spread = (ca.pct_change().rolling(120, min_periods=40).sum() - cb.pct_change().rolling(120, min_periods=40).sum())
        z = (spread - spread.rolling(240, min_periods=80).mean()) / spread.rolling(240, min_periods=80).std()
        sig_a = pd.Series(0.0, index=ca.index)
        sig_b = pd.Series(0.0, index=ca.index)
        sig_a.loc[z > 2.0] = -0.5
        sig_b.loc[z > 2.0] = 0.5
        sig_a.loc[z < -2.0] = 0.5
        sig_b.loc[z < -2.0] = -0.5
        flat = z.abs() < 0.4
        sig_a.loc[flat] = 0.0
        sig_b.loc[flat] = 0.0
        out[a] = sig_a.replace(0.0, pd.NA).ffill().fillna(0.0).clip(-0.5, 0.5)
        out[b] = sig_b.reindex(data_map[b].index).replace(0.0, pd.NA).ffill().fillna(0.0).clip(-0.5, 0.5)
        return out
''',
        "crypto-vol-target-rotation": '''import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        out = {}
        scores = {}
        for code, df in data_map.items():
            close = df["close"]
            ret = close.pct_change()
            vol = ret.rolling(30, min_periods=15).std() * (365 ** 0.5)
            trend = close / close.rolling(90, min_periods=30).mean() - 1
            raw = (trend.clip(lower=0) / vol.replace(0, pd.NA)).fillna(0.0)
            scores[code] = raw.reindex(df.index)
        if not scores:
            return out
        aligned = pd.DataFrame(scores).fillna(0.0)
        total = aligned.sum(axis=1).replace(0, pd.NA)
        weights = aligned.div(total, axis=0).fillna(0.0).clip(0.0, 0.8)
        for code, df in data_map.items():
            out[code] = weights[code].reindex(df.index).ffill().fillna(0.0)
        return out
''',
        "crypto-event-driven-risk": '''import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        out = {}
        for code, df in data_map.items():
            close = df["close"]
            high = df["high"]
            low = df["low"]
            volume = df.get("volume", pd.Series(0.0, index=df.index))
            tr = pd.concat([(high - low), (high - close.shift()).abs(), (low - close.shift()).abs()], axis=1).max(axis=1)
            atr = tr.rolling(14, min_periods=7).mean()
            event = volume > volume.rolling(48, min_periods=12).mean() * 1.8
            breakout = close > high.rolling(24, min_periods=12).max().shift(1)
            invalid = close < close.shift(1) - 1.5 * atr
            signal = pd.Series(0.0, index=df.index)
            signal.loc[event & breakout] = 1.0
            signal.loc[invalid] = 0.0
            out[code] = signal.replace(0.0, pd.NA).ffill(limit=18).fillna(0.0).clip(0.0, 1.0)
        return out
''',
        "professional-grid-trading": '''import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        out = {}
        for code, df in data_map.items():
            close = df["close"]
            ret = close.pct_change()
            lower = 54000.0
            upper = 76000.0
            center = (lower + upper) / 2.0
            in_range = (close >= lower) & (close <= upper)
            vol_ok = ret.rolling(24, min_periods=8).std() * 100 < 4.0
            signal = pd.Series(0.0, index=df.index)
            signal.loc[in_range & vol_ok & (close < center)] = 0.35
            signal.loc[in_range & vol_ok & (close >= center)] = 0.15
            signal.loc[(close < lower * 0.92) | (close > upper * 1.05)] = 0.0
            out[code] = signal.ffill().fillna(0.0).clip(0.0, 0.35)
        return out
''',
        "classic-turtle-trading": '''import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        out = {}
        for code, df in data_map.items():
            close = df["close"].astype(float)
            high = df["high"].astype(float)
            low = df["low"].astype(float)

            prev_close = close.shift(1)
            tr = pd.concat(
                [
                    high - low,
                    (high - prev_close).abs(),
                    (low - prev_close).abs(),
                ],
                axis=1,
            ).max(axis=1)
            atr = tr.rolling(20, min_periods=10).mean()

            fast_entry_high = high.rolling(20, min_periods=20).max().shift(1)
            fast_entry_low = low.rolling(20, min_periods=20).min().shift(1)
            fast_exit_high = high.rolling(10, min_periods=10).max().shift(1)
            fast_exit_low = low.rolling(10, min_periods=10).min().shift(1)
            slow_entry_high = high.rolling(55, min_periods=35).max().shift(1)
            slow_entry_low = low.rolling(55, min_periods=35).min().shift(1)
            slow_exit_high = high.rolling(20, min_periods=20).max().shift(1)
            slow_exit_low = low.rolling(20, min_periods=20).min().shift(1)

            signal = pd.Series(0.0, index=df.index)
            position = 0
            units = 0
            last_unit_price = 0.0
            stop_price = 0.0
            peak_equity = 1.0
            strategy_equity = 1.0
            previous_price = None
            pause_new_entries = False

            base_unit_weight = 0.10
            max_units = 4
            add_unit_atr = 0.5
            stop_atr = 2.0
            max_drawdown_pause = 0.12

            for ts in df.index:
                price = close.loc[ts]
                current_atr = atr.loc[ts]
                if pd.isna(price) or pd.isna(current_atr) or current_atr <= 0:
                    signal.loc[ts] = position * units * base_unit_weight
                    previous_price = price if not pd.isna(price) else previous_price
                    continue

                if previous_price is not None and position != 0:
                    strategy_equity *= 1 + position * units * base_unit_weight * ((price / previous_price) - 1)
                    peak_equity = max(peak_equity, strategy_equity)
                    pause_new_entries = ((peak_equity - strategy_equity) / peak_equity) >= max_drawdown_pause

                long_exit = price < min(fast_exit_low.loc[ts], slow_exit_low.loc[ts]) if not pd.isna(fast_exit_low.loc[ts]) and not pd.isna(slow_exit_low.loc[ts]) else False
                short_exit = price > max(fast_exit_high.loc[ts], slow_exit_high.loc[ts]) if not pd.isna(fast_exit_high.loc[ts]) and not pd.isna(slow_exit_high.loc[ts]) else False

                if position > 0 and (price <= stop_price or long_exit):
                    position = 0
                    units = 0
                    last_unit_price = 0.0
                    stop_price = 0.0
                elif position < 0 and (price >= stop_price or short_exit):
                    position = 0
                    units = 0
                    last_unit_price = 0.0
                    stop_price = 0.0

                if position == 0 and not pause_new_entries:
                    fast_long = not pd.isna(fast_entry_high.loc[ts]) and price > fast_entry_high.loc[ts]
                    slow_long = not pd.isna(slow_entry_high.loc[ts]) and price > slow_entry_high.loc[ts]
                    fast_short = not pd.isna(fast_entry_low.loc[ts]) and price < fast_entry_low.loc[ts]
                    slow_short = not pd.isna(slow_entry_low.loc[ts]) and price < slow_entry_low.loc[ts]
                    if fast_long or slow_long:
                        position = 1
                        units = 1
                        last_unit_price = float(price)
                        stop_price = float(price - stop_atr * current_atr)
                    elif fast_short or slow_short:
                        position = -1
                        units = 1
                        last_unit_price = float(price)
                        stop_price = float(price + stop_atr * current_atr)
                elif position > 0 and units < max_units and price >= last_unit_price + add_unit_atr * current_atr:
                    units += 1
                    last_unit_price = float(price)
                    stop_price = max(stop_price, float(price - stop_atr * current_atr))
                elif position < 0 and units < max_units and price <= last_unit_price - add_unit_atr * current_atr:
                    units += 1
                    last_unit_price = float(price)
                    stop_price = min(stop_price, float(price + stop_atr * current_atr))

                signal.loc[ts] = position * units * base_unit_weight
                previous_price = price

            out[code] = signal.ffill().fillna(0.0).clip(-0.40, 0.40)
        return out
''',
    }
    return engines[strategy_id]


def _coerce_backtest_float(metrics: Optional[BacktestMetrics], key: str, default: float = 0.0) -> float:
    if metrics is None:
        return default
    value = getattr(metrics, key, default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _strategy_or_404(strategy_id: str, *, user_id: int):
    store = _get_strategy_store()
    for record in store.list_strategies(user_id=int(user_id)):
        if str(record.id) == strategy_id:
            return record
    raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")


def _normalize_backtest_symbol(symbol: str) -> str:
    normalized = str(symbol or "").replace("/", "-").replace("_", "-").upper().strip()
    if not re.fullmatch(r"[A-Z0-9]+-USDT", normalized):
        raise HTTPException(status_code=400, detail="symbol must be a USDT crypto pair like BTC-USDT")
    return normalized


def _strategy_signal_engine_code(record: Any, symbol: str) -> str:
    code = str(getattr(record, "code", "") or "").strip()
    language = str(getattr(record, "language", "") or "").strip().lower()
    if not code:
        raise HTTPException(status_code=400, detail="strategy code is empty")

    try:
        package = json.loads(code)
    except json.JSONDecodeError:
        package = None

    if isinstance(package, dict):
        signal = package.get("paper_signal") or package.get("signal") or {}
        action = str(signal.get("action") or signal.get("side") or "HOLD").upper() if isinstance(signal, dict) else "HOLD"
        target = signal.get("target_weight") if isinstance(signal, dict) else None
        try:
            target_weight = float(target)
        except (TypeError, ValueError):
            target_weight = 0.25 if action in {"BUY", "BUY_TO_OPEN"} else 0.0
        target_weight = max(0.0, min(target_weight, 1.0))
        return f'''
import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        target_weight = {target_weight!r}
        out = {{}}
        for code, df in data_map.items():
            index = getattr(df, "index", None)
            out[code] = pd.Series(target_weight, index=index).fillna(0.0)
        return out
'''

    if not _env_flag_enabled("VIBE_TRADING_ALLOW_UNSANDBOXED_PYTHON_STRATEGIES"):
        raise HTTPException(
            status_code=403,
            detail=(
                "Python strategy backtests are disabled until sandboxed execution is configured. "
                "Use JSON StrategySpec/market templates, or set "
                "VIBE_TRADING_ALLOW_UNSANDBOXED_PYTHON_STRATEGIES=1 only for trusted single-tenant deployments."
            ),
        )

    if language != "python":
        raise HTTPException(status_code=400, detail="real backtest currently supports Python strategies or JSON StrategySpec only")

    if "class SignalEngine" in code:
        _validate_strategy_python_syntax(code)
        return code

    if re.search(r"\bdef\s+generate_signals\s*\(", code):
        generated_code = code + '''


import pandas as pd


class SignalEngine:
    def generate(self, data_map):
        out = {}
        for code, df in data_map.items():
            signal = generate_signals(df)
            if not isinstance(signal, pd.Series):
                signal = pd.Series(signal, index=df.index)
            out[code] = signal.reindex(df.index).ffill().fillna(0.0).clip(-1.0, 1.0)
        return out
'''
        _validate_strategy_python_syntax(generated_code)
        return generated_code

    raise HTTPException(
        status_code=400,
        detail="Python strategy must define class SignalEngine or def generate_signals(data)",
    )


def _validate_strategy_python_syntax(source: str) -> None:
    try:
        compile(source, "<strategy-editor>", "exec")
    except SyntaxError as exc:
        location = f"line {exc.lineno}" if exc.lineno else "unknown line"
        if exc.offset:
            location = f"{location}, column {exc.offset}"
        message = exc.msg or "invalid syntax"
        raise HTTPException(
            status_code=400,
            detail=f"Strategy code syntax error at {location}: {message}",
        ) from exc


async def _execute_backtest_run(
    *,
    run_id: str,
    prompt: str,
    context: Dict[str, Any],
    signal_code: str,
    config: Dict[str, Any],
) -> StrategyMarketBacktestResponse:
    run_dir = RUNS_DIR / run_id
    code_dir = run_dir / "code"
    code_dir.mkdir(parents=True, exist_ok=True)
    (code_dir / "signal_engine.py").write_text(signal_code, encoding="utf-8")
    (run_dir / "config.json").write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
    (run_dir / "req.json").write_text(
        json.dumps({"prompt": prompt, "context": context}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    from src.tools.backtest_tool import run_backtest

    raw_result = await asyncio.to_thread(run_backtest, str(run_dir))
    try:
        result = json.loads(raw_result)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"backtest runner returned invalid JSON: {raw_result[-500:]}") from exc
    if result.get("status") != "ok":
        detail = result.get("error") or result.get("stdout") or result.get("stderr") or "backtest failed"
        raise HTTPException(status_code=502, detail=str(detail)[-1000:])

    run_response = _build_response_from_run_dir(run_dir, elapsed=0.0)
    metrics = run_response.metrics
    total_return = _coerce_backtest_float(metrics, "total_return")
    annual_return = _coerce_backtest_float(metrics, "annual_return")
    max_drawdown = _coerce_backtest_float(metrics, "max_drawdown")
    win_rate = _coerce_backtest_float(metrics, "win_rate")
    trade_count = int(_coerce_backtest_float(metrics, "trade_count"))

    return StrategyMarketBacktestResponse(
        strategy_id=str(context.get("strategy_id") or context.get("strategy_market_id") or ""),
        status="passed" if _coerce_backtest_float(metrics, "sharpe") >= 1 and max_drawdown > -0.25 else "failed",
        run_id=run_id,
        run_directory=str(run_dir),
        symbol=",".join(config.get("codes") or []),
        timeframe=str(config.get("interval") or ""),
        period=f"{config.get('start_date')} - {config.get('end_date')}",
        totalReturnPct=round(total_return * 100, 2),
        annualizedReturnPct=round(annual_return * 100, 2),
        maxDrawdownPct=round(abs(max_drawdown) * 100, 2),
        sharpe=round(_coerce_backtest_float(metrics, "sharpe"), 2),
        winRatePct=round(win_rate * 100, 2),
        tradeCount=trade_count,
        engine=str(config.get("engine_name") or config.get("strategy_engine") or "user_strategy_backtest_v1"),
        assumptions=list(config.get("assumptions") or []),
        warnings=list(config.get("warnings") or []),
    )


async def _run_marketplace_backtest(
    payload: StrategyMarketBacktestRequest,
    ctx: AuthContext,
) -> StrategyMarketBacktestResponse:
    strategy_id = payload.strategy_id
    if strategy_id not in _MARKET_BACKTEST_IDS:
        raise HTTPException(status_code=404, detail=f"market strategy {strategy_id!r} is not supported for real backtest")

    spec = _market_backtest_strategy_config(strategy_id)
    codes = list(spec["codes"])
    if payload.symbol:
        symbol = payload.symbol.replace("/", "-").upper()
        if not re.fullmatch(r"[A-Z0-9]+-USDT", symbol):
            raise HTTPException(status_code=400, detail="symbol must be a USDT crypto pair like BTC-USDT")
        if strategy_id == "crypto-stat-arb-pairs":
            codes = [codes[0], symbol] if symbol != codes[0] else codes
        else:
            codes = [symbol]

    interval = payload.interval or spec["interval"]
    if interval not in _MARKET_BACKTEST_INTERVALS:
        raise HTTPException(status_code=400, detail=f"unsupported interval {interval!r}")

    try:
        start_ts = datetime.fromisoformat(payload.start_date)
        end_ts = datetime.fromisoformat(payload.end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="start_date and end_date must be YYYY-MM-DD") from exc
    if start_ts > end_ts:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")

    run_id = f"market_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    config = {
        "source": "okx",
        "codes": codes,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "interval": interval,
        "engine": "daily",
        "initial_cash": 100000.0,
        "leverage": 1.0,
        "maker_rate": 0.0002,
        "taker_rate": 0.0005,
        "slippage": 0.0005,
        "funding_rate": float(spec.get("funding_rate", 0.0)),
        "benchmark": "auto",
        "strategy_market_id": strategy_id,
        "strategy_engine": str(spec["engine_name"]),
        "assumptions": list(spec.get("assumptions", [])),
        "warnings": list(spec.get("warnings", [])),
    }
    return await _execute_backtest_run(
        run_id=run_id,
        prompt=f"strategy market real backtest: {strategy_id}",
        context={"user_id": ctx.user_id, "strategy_market_id": strategy_id},
        signal_code=_market_signal_engine_code(strategy_id),
        config=config,
    )


@app.post("/strategy-market/backtest", response_model=StrategyMarketBacktestResponse)
async def run_strategy_market_backtest(
    payload: StrategyMarketBacktestRequest,
    ctx: AuthContext = Depends(require_auth),
):
    """Run a real, server-side backtest for a whitelisted marketplace strategy."""
    return await _run_marketplace_backtest(payload, ctx)


@app.post("/strategies/{strategy_id}/backtest", response_model=StrategyMarketBacktestResponse)
async def run_strategy_backtest(
    strategy_id: str,
    payload: StrategyBacktestRequest,
    ctx: AuthContext = Depends(require_auth),
):
    """Run a real, server-side backtest for a saved personal strategy."""
    record = _strategy_or_404(strategy_id, user_id=ctx.user_id)

    from backtest.loaders.registry import VALID_SOURCES

    symbol = _normalize_backtest_symbol(payload.symbol)
    if payload.source not in VALID_SOURCES:
        raise HTTPException(status_code=400, detail=f"source must be one of {VALID_SOURCES}")
    if payload.interval not in _MARKET_BACKTEST_INTERVALS:
        raise HTTPException(status_code=400, detail=f"unsupported interval {payload.interval!r}")
    try:
        start_ts = datetime.fromisoformat(payload.start_date)
        end_ts = datetime.fromisoformat(payload.end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="start_date and end_date must be YYYY-MM-DD") from exc
    if start_ts > end_ts:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date")

    config = {
        "source": payload.source,
        "codes": [symbol],
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "interval": payload.interval,
        "engine": "daily",
        "initial_cash": float(payload.initial_capital),
        "leverage": 1.0,
        "maker_rate": 0.0002,
        "taker_rate": 0.0005,
        "slippage": 0.0005,
        "benchmark": "auto",
        "strategy_id": record.id,
        "strategy_engine": "user_strategy_backtest_v1",
        "assumptions": [
            "Server-side backtest using real historical OHLCV from the configured data loader.",
            "Default strategy-library runs use one USDT crypto pair unless overridden by request.",
        ],
        "warnings": [],
    }
    run_id = f"strategy_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    return await _execute_backtest_run(
        run_id=run_id,
        prompt=f"strategy library real backtest: {record.id}",
        context={"user_id": ctx.user_id, "strategy_id": record.id},
        signal_code=_strategy_signal_engine_code(record, symbol),
        config=config,
    )


@app.get("/strategies", response_model=StrategyLibraryResponse)
async def list_strategy_library(ctx: AuthContext = Depends(require_auth)):
    """List persisted personal strategies."""
    store = _get_strategy_store()
    share_statuses = store.list_share_statuses(user_id=ctx.user_id)
    strategies = []
    for item in store.list_strategies(user_id=ctx.user_id):
        data = item.to_dict()
        data["shareStatus"] = share_statuses.get(item.id, "none")
        strategies.append(data)
    return {"strategies": strategies}


@app.put("/strategies", response_model=StrategyLibraryResponse)
async def replace_strategy_library(req: ReplaceStrategyLibraryRequest, ctx: AuthContext = Depends(require_auth)):
    """Replace the full persisted personal strategy library."""
    from src.strategies import StrategyRecord

    store = _get_strategy_store()
    try:
        records = [StrategyRecord.from_payload(item.model_dump()) for item in req.strategies]
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    saved = store.replace_all(records, user_id=ctx.user_id)
    return {"strategies": [item.to_dict() for item in saved]}


@app.put("/strategies/{strategy_id}", response_model=StrategyLibraryItem)
async def upsert_strategy(
    strategy_id: str,
    item: StrategyLibraryItem,
    ctx: AuthContext = Depends(require_auth),
):
    """Create or update one persisted strategy."""
    from src.strategies import StrategyRecord

    if strategy_id != item.id:
        raise HTTPException(status_code=400, detail="strategy id in path and body must match")
    store = _get_strategy_store()
    try:
        record = StrategyRecord.from_payload(item.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return store.upsert_strategy(record, user_id=ctx.user_id).to_dict()


@app.post("/strategies/{strategy_id}/publish", response_model=PublicStrategyMarketItem)
async def publish_strategy(strategy_id: str, ctx: AuthContext = Depends(require_auth)):
    """Submit the current user's strategy for operator review before public listing."""
    record = _strategy_or_404(strategy_id, user_id=ctx.user_id)
    if not str(record.description or record.strategyDescription or "").strip():
        raise HTTPException(status_code=400, detail="strategy description is required before publishing")
    if not str(record.code or "").strip():
        raise HTTPException(status_code=400, detail="strategy code is required before publishing")
    store = _get_strategy_store()
    risk_warnings = [
        "User-published strategy. Review code, assumptions, and risk limits before running live.",
    ]
    public_record = store.publish_strategy(
        record,
        user_id=ctx.user_id,
        backtest_summary={},
        risk_warnings=risk_warnings,
    )
    return public_record.to_dict()


@app.delete("/strategies/{strategy_id}")
async def delete_strategy(strategy_id: str, ctx: AuthContext = Depends(require_auth)):
    """Delete one persisted strategy."""
    store = _get_strategy_store()
    deleted = store.delete_strategy(strategy_id, user_id=ctx.user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")
    return {"status": "deleted", "id": strategy_id}


@app.post("/paper/deployments", response_model=PaperDeploymentActionResponse)
async def create_paper_deployment(payload: PaperDeploymentCreateRequest, ctx: AuthContext = Depends(require_auth)):
    """Create a draft paper deployment from a saved strategy."""
    from src.paper_trading import PaperTradingError

    svc = _get_paper_service()
    try:
        deployment = svc.create_deployment(
            user_id=_paper_user_id(ctx),
            strategy_id=payload.strategy_id,
            limits_payload=payload.limits,
            execution_mode=payload.execution_mode,
            connector_profile_id=payload.connector_profile_id,
        )
        return {"deployment": deployment.to_dict()}
    except (PaperTradingError, ValueError) as exc:
        raise _paper_http_error(exc) from exc


@app.get("/paper/deployments", response_model=PaperDeploymentListResponse)
async def list_paper_deployments(ctx: AuthContext = Depends(require_auth)):
    """List the caller's paper deployments."""
    svc = _get_paper_service()
    return {"deployments": [item.to_dict() for item in svc.list_deployments(user_id=_paper_user_id(ctx))]}


@app.get("/paper/deployments/{deployment_id}", response_model=PaperDeploymentStatusResponse)
async def get_paper_deployment_status(deployment_id: str, ctx: AuthContext = Depends(require_auth)):
    """Return deployment state and recent paper activity."""
    from src.paper_trading import PaperTradingError

    svc = _get_paper_service()
    try:
        return svc.status(deployment_id, user_id=_paper_user_id(ctx))
    except PaperTradingError as exc:
        raise _paper_http_error(exc) from exc


async def _paper_action(deployment_id: str, action: str, ctx: AuthContext) -> dict[str, Any]:
    from src.paper_trading import PaperTradingError

    svc = _get_paper_service()
    try:
        deployment = svc.set_status(deployment_id, user_id=_paper_user_id(ctx), action=action)
        return {"deployment": deployment.to_dict()}
    except PaperTradingError as exc:
        raise _paper_http_error(exc) from exc


@app.post("/paper/deployments/{deployment_id}/start", response_model=PaperDeploymentActionResponse)
async def start_paper_deployment(deployment_id: str, ctx: AuthContext = Depends(require_auth)):
    """Start a draft or paused paper deployment."""
    return await _paper_action(deployment_id, "start", ctx)


@app.post("/paper/deployments/{deployment_id}/pause", response_model=PaperDeploymentActionResponse)
async def pause_paper_deployment(deployment_id: str, ctx: AuthContext = Depends(require_auth)):
    """Pause a running paper deployment."""
    return await _paper_action(deployment_id, "pause", ctx)


@app.post("/paper/deployments/{deployment_id}/resume", response_model=PaperDeploymentActionResponse)
async def resume_paper_deployment(deployment_id: str, ctx: AuthContext = Depends(require_auth)):
    """Resume a paused paper deployment."""
    return await _paper_action(deployment_id, "resume", ctx)


@app.post("/paper/deployments/{deployment_id}/archive", response_model=PaperDeploymentActionResponse)
async def archive_paper_deployment(deployment_id: str, ctx: AuthContext = Depends(require_auth)):
    """Archive a paper deployment."""
    return await _paper_action(deployment_id, "archive", ctx)


@app.post("/paper/deployments/{deployment_id}/tick", response_model=PaperTickResponse)
async def run_paper_deployment_tick(deployment_id: str, ctx: AuthContext = Depends(require_auth)):
    """Run one manual paper deployment tick."""
    from src.paper_trading import PaperTradingError

    svc = _get_paper_service()
    try:
        return await svc.run_tick(deployment_id, user_id=_paper_user_id(ctx))
    except PaperTradingError as exc:
        raise _paper_http_error(exc) from exc


@app.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(request: CreateSessionRequest, ctx: AuthContext = Depends(require_auth)):
    """Create a chat session."""
    svc = _get_session_service()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    session = svc.create_session(title=request.title, config=request.config, user_id=ctx.user_id)
    return SessionResponse(
        session_id=session.session_id,
        title=session.title,
        status=session.status.value,
        created_at=session.created_at,
        updated_at=session.updated_at,
        last_attempt_id=session.last_attempt_id,
    )


@app.get("/sessions", response_model=List[SessionResponse])
async def list_sessions(limit: int = Query(50, ge=1, le=200), ctx: AuthContext = Depends(require_auth)):
    """List sessions."""
    svc = _get_session_service()
    if not svc:
        raise HTTPException(status_code=501, detail="Session runtime not enabled")
    if ctx.operator:
        sessions = svc.list_sessions(limit=limit)
    elif hasattr(svc.store, "list_sessions_for_user") and ctx.user_id is not None:
        sessions = svc.store.list_sessions_for_user(ctx.user_id, limit=limit)
    else:
        sessions = [s for s in svc.list_sessions(limit=200) if _session_belongs_to_context(s, ctx)][:limit]
    return [
        SessionResponse(
            session_id=s.session_id,
            title=s.title,
            status=s.status.value,
            created_at=s.created_at,
            updated_at=s.updated_at,
            last_attempt_id=s.last_attempt_id,
        )
        for s in sessions
    ]


@app.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str, ctx: AuthContext = Depends(require_auth)):
    """Get one session by id."""
    _validate_path_param(session_id, "session_id")
    _svc, session = _require_user_session(session_id, ctx)
    return SessionResponse(
        session_id=session.session_id,
        title=session.title,
        status=session.status.value,
        created_at=session.created_at,
        updated_at=session.updated_at,
        last_attempt_id=session.last_attempt_id,
    )


@app.post(
    "/sessions/{session_id}/goal",
    response_model=GoalSnapshotResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_session_goal(session_id: str, req: CreateGoalRequest, ctx: AuthContext = Depends(require_auth)):
    """Create or replace the current finance research goal for a session."""
    _validate_path_param(session_id, "session_id")
    svc, _session = _require_user_session(session_id, ctx)
    from src.goal import RiskTier

    criteria = [item.strip() for item in req.criteria if item.strip()]
    if not criteria:
        criteria = default_goal_criteria()
    try:
        risk_tier = RiskTier(req.risk_tier)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid risk_tier: {req.risk_tier}") from exc
    if risk_tier is RiskTier.LIVE_TRADING_OR_EXECUTION:
        raise HTTPException(status_code=400, detail="live trading or execution goals are not supported")

    goal_store = _get_goal_store()
    try:
        goal = goal_store.replace_goal(
            session_id=session_id,
            objective=req.objective,
            criteria=criteria,
            ui_summary=req.ui_summary,
            source="api",
            protocol=req.protocol,
            risk_tier=risk_tier,
            token_budget=req.token_budget,
            turn_budget=req.turn_budget,
            time_budget_seconds=req.time_budget_seconds,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    snapshot = goal_store.get_goal_snapshot(goal.goal_id)
    if snapshot is None:
        raise HTTPException(status_code=500, detail="Goal created but could not be reloaded")
    svc.event_bus.emit(session_id, "goal.created", {"goal": snapshot["goal"]})
    return snapshot


@app.get(
    "/sessions/{session_id}/goal",
    response_model=GoalSnapshotResponse,
)
async def get_session_goal(session_id: str, ctx: AuthContext = Depends(require_auth)):
    """Return the current finance research goal snapshot for a session."""
    _validate_path_param(session_id, "session_id")
    _require_user_session(session_id, ctx)
    snapshot = _get_goal_store().get_current_snapshot(session_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="No current goal")
    return snapshot


@app.patch(
    "/sessions/{session_id}/goal",
    response_model=UpdateGoalResponse,
)
async def update_session_goal(session_id: str, req: UpdateGoalRequest, ctx: AuthContext = Depends(require_auth)):
    """Edit the current finance research goal without replacing the session."""
    _validate_path_param(session_id, "session_id")
    svc, _session = _require_user_session(session_id, ctx)
    from src.goal import StaleGoalError

    if req.objective is None and req.ui_summary is None:
        raise HTTPException(status_code=400, detail="objective or ui_summary is required")

    goal_store = _get_goal_store()
    try:
        goal = goal_store.update_goal(
            session_id=session_id,
            goal_id=req.goal_id,
            expected_goal_id=req.expected_goal_id,
            objective=req.objective,
            ui_summary=req.ui_summary,
        )
    except StaleGoalError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    snapshot = goal_store.get_goal_snapshot(goal.goal_id)
    if snapshot is None:
        raise HTTPException(status_code=500, detail="Goal snapshot could not be reloaded")
    svc.event_bus.emit(session_id, "goal.updated", {"goal": snapshot["goal"], "snapshot": snapshot})
    return {"goal": snapshot["goal"], "snapshot": snapshot}


@app.post(
    "/sessions/{session_id}/goal/evidence",
    response_model=AddGoalEvidenceResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_session_goal_evidence(
    session_id: str,
    req: AddGoalEvidenceRequest,
    ctx: AuthContext = Depends(require_auth),
):
    """Append traceable evidence to the current finance research goal."""
    _validate_path_param(session_id, "session_id")
    svc, _session = _require_user_session(session_id, ctx)
    if req.run_id:
        _require_run_access(req.run_id, ctx)
    from dataclasses import asdict
    from src.goal import EvidenceInput, StaleGoalError

    goal_store = _get_goal_store()
    try:
        evidence = goal_store.append_evidence(
            session_id=session_id,
            goal_id=req.goal_id,
            expected_goal_id=req.expected_goal_id,
            evidence=EvidenceInput(
                criterion_id=req.criterion_id,
                claim_id=req.claim_id,
                evidence_type=req.evidence_type,
                text=req.text,
                tool_call_id=req.tool_call_id,
                run_id=req.run_id,
                source_provider=req.source_provider,
                source_type=req.source_type,
                source_uri=req.source_uri,
                symbol_universe=req.symbol_universe,
                benchmark=req.benchmark,
                timeframe=req.timeframe,
                method=req.method,
                assumptions=req.assumptions,
                artifact_path=req.artifact_path,
                artifact_hash=req.artifact_hash,
                data_as_of=req.data_as_of,
                confidence=req.confidence,
                caveat=req.caveat,
                contradicts_claim_ids=req.contradicts_claim_ids,
            ),
        )
    except StaleGoalError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    snapshot = goal_store.get_goal_snapshot(req.goal_id)
    if snapshot is None:
        raise HTTPException(status_code=500, detail="Goal snapshot could not be reloaded")
    svc.event_bus.emit(
        session_id,
        "goal.evidence",
        {"evidence": asdict(evidence), "goal_id": req.goal_id},
    )
    return {"evidence": asdict(evidence), "snapshot": snapshot}


@app.patch(
    "/sessions/{session_id}/goal/status",
    response_model=UpdateGoalStatusResponse,
)
async def update_session_goal_status(
    session_id: str,
    req: UpdateGoalStatusRequest,
    ctx: AuthContext = Depends(require_auth),
):
    """Update the current finance research goal status."""
    _validate_path_param(session_id, "session_id")
    svc, _session = _require_user_session(session_id, ctx)
    from src.goal import AuditRow, GoalStatus, StaleGoalError

    try:
        next_status = GoalStatus(req.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid goal status: {req.status}") from exc

    goal_store = _get_goal_store()
    try:
        goal = goal_store.update_status(
            session_id=session_id,
            goal_id=req.goal_id,
            expected_goal_id=req.expected_goal_id,
            status=next_status,
            audit=[
                AuditRow(
                    criterion_id=row.criterion_id,
                    result=row.result,
                    evidence_ids=row.evidence_ids,
                    notes=row.notes,
                )
                for row in req.audit
            ],
            recap=req.recap,
        )
    except StaleGoalError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    snapshot = goal_store.get_goal_snapshot(goal.goal_id)
    if snapshot is None:
        raise HTTPException(status_code=500, detail="Goal snapshot could not be reloaded")
    svc.event_bus.emit(session_id, "goal.updated", {"goal": snapshot["goal"], "snapshot": snapshot})
    return {"goal": snapshot["goal"], "snapshot": snapshot}


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str, ctx: AuthContext = Depends(require_auth)):
    """Delete a session."""
    _validate_path_param(session_id, "session_id")
    svc, _session = _require_user_session(session_id, ctx)
    deleted = svc.delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
    _get_goal_store().delete_session_goals(session_id)
    return {"status": "deleted", "session_id": session_id}


class UpdateSessionRequest(BaseModel):
    """Session update fields."""
    title: Optional[str] = None


@app.patch("/sessions/{session_id}")
async def update_session(session_id: str, req: UpdateSessionRequest, ctx: AuthContext = Depends(require_auth)):
    """Update session fields (e.g. title)."""
    _validate_path_param(session_id, "session_id")
    svc, session = _require_user_session(session_id, ctx)
    if req.title is not None:
        session.title = req.title
    from datetime import datetime
    session.updated_at = datetime.now().isoformat()
    svc.store.update_session(session)
    return {"status": "updated", "session_id": session_id}


@app.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    payload: SendMessageRequest,
    http_request: Request,
    ctx: AuthContext = Depends(require_auth),
):
    """Send a user message and start the agent loop (natural language strategy)."""
    _validate_path_param(session_id, "session_id")
    svc, _session = _require_user_session(session_id, ctx)
    try:
        result = await svc.send_message(
            session_id=session_id,
            content=payload.content,
            include_shell_tools=_shell_tools_enabled_for_request(http_request),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/sessions/{session_id}/cancel")
async def cancel_session(session_id: str, ctx: AuthContext = Depends(require_auth)):
    """Cancel the in-flight agent loop for this session."""
    _validate_path_param(session_id, "session_id")
    svc, _session = _require_user_session(session_id, ctx)
    cancelled = svc.cancel_current(session_id)
    if not cancelled:
        return {"status": "no_active_loop"}
    return {"status": "cancelled"}


@app.get("/sessions/{session_id}/messages", response_model=List[MessageResponse])
async def get_messages(
    session_id: str,
    limit: int = Query(100, ge=1, le=1000),
    ctx: AuthContext = Depends(require_auth),
):
    """List messages for a session."""
    _validate_path_param(session_id, "session_id")
    svc, _session = _require_user_session(session_id, ctx)
    messages = svc.get_messages(session_id, limit=limit)
    return [
        MessageResponse(
            message_id=m.message_id,
            session_id=m.session_id,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
            linked_attempt_id=m.linked_attempt_id,
            metadata=m.metadata if m.metadata else None,
        )
        for m in messages
    ]


@app.get("/sessions/{session_id}/events")
async def session_events(
    session_id: str,
    request: Request,
    last_event_id: Optional[str] = Query(None, alias="Last-Event-ID"),
    replay: Optional[str] = Query(None),
    ctx: AuthContext = Depends(require_event_stream_auth),
):
    """SSE stream for agent events."""
    _validate_path_param(session_id, "session_id")
    svc, session = _require_user_session(session_id, ctx)

    header_id = request.headers.get("Last-Event-ID")
    event_id = header_id or last_event_id
    replay_active = (replay or "").lower() == "active"
    replay_all = False
    if replay_active and not event_id and session.last_attempt_id:
        attempt = svc.store.get_attempt(session_id, session.last_attempt_id)
        attempt_status = getattr(attempt.status, "value", attempt.status) if attempt else None
        replay_all = attempt_status == "running"

    async def event_generator():
        async for event in svc.event_bus.subscribe(
            session_id,
            last_event_id=event_id,
            replay_all=replay_all,
        ):
            if await request.is_disconnected():
                break
            yield event.to_sse()
            relayed = _mandate_proposal_frame_from_tool_result(event)
            if relayed is not None:
                yield relayed
            live_action = _live_action_frame_from_tool_result(event)
            if live_action is not None:
                yield live_action

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================================
# File Upload
# ============================================================================

_BLOCKED_UPLOAD_EXT = {
    # binaries / executables we should never accept
    ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".app", ".dmg",
    ".so", ".dll", ".dylib",
    # executable-adjacent source, shell, config, and template files
    ".py", ".pyw", ".sh", ".bash", ".zsh", ".fish", ".ps1",
    ".yaml", ".yml", ".j2", ".jinja", ".jinja2", ".template",
    # archives — don't auto-extract; user can unpack locally
    ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz",
}

_BLOCKED_UPLOAD_NAMES = {
    "dockerfile",
    "containerfile",
}


_SHADOW_ID_RE = __import__("re").compile(r"^shadow_[0-9a-f]{8}$")


@app.get("/shadow-reports/{shadow_id}", dependencies=[Depends(require_operator_auth)])
async def get_shadow_report(shadow_id: str, format: str = "html"):
    """Serve a rendered Shadow Account report (HTML by default, PDF if available).

    Reports live under ``~/.vibe-trading/shadow_reports/<shadow_id>.{html,pdf}``.
    """
    if not _SHADOW_ID_RE.match(shadow_id):
        raise HTTPException(status_code=400, detail="invalid shadow_id")
    if format not in ("html", "pdf"):
        raise HTTPException(status_code=400, detail="format must be html or pdf")

    reports_dir = Path.home() / ".vibe-trading" / "shadow_reports"
    path = reports_dir / f"{shadow_id}.{format}"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Shadow report not found: {shadow_id}.{format}")

    media_type = "text/html; charset=utf-8" if format == "html" else "application/pdf"
    # Inline so browsers render HTML/PDF directly instead of forcing download.
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{shadow_id}.{format}"'},
    )


@app.post("/upload")
async def upload_file(file: UploadFile, ctx: AuthContext = Depends(require_auth)):
    """Upload any document or data file (max 50MB).

    Accepts most common formats: PDF, Word, Excel, PowerPoint, images,
    CSV/TSV, plain text, JSON, and TOML. Executables, executable-adjacent
    source/config/template files, and archives are rejected.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    filename = Path(file.filename).name
    ext = Path(filename).suffix.lower()
    if ext in _BLOCKED_UPLOAD_EXT or filename.lower() in _BLOCKED_UPLOAD_NAMES:
        raise HTTPException(
            status_code=400,
            detail="This file type is not allowed for upload.",
        )

    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOADS_DIR / safe_name
    total_size = 0

    try:
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        with dest.open("wb") as handle:
            while True:
                chunk = await file.read(_UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > MAX_UPLOAD_SIZE:
                    handle.close()
                    if dest.exists():
                        dest.unlink()
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large (limit {MAX_UPLOAD_SIZE // (1024 * 1024)} MB)",
                    )
                handle.write(chunk)
    except HTTPException:
        raise
    except OSError as exc:
        if dest.exists():
            dest.unlink()
        raise HTTPException(
            status_code=500,
            detail="Upload failed while storing the file. Please retry or choose a different file.",
        ) from exc
    finally:
        await file.close()

    if ctx.user_id is not None:
        try:
            from src.persistence import mysql_configured
            from src.persistence.mysql import mysql_connection

            if mysql_configured():
                with mysql_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            CREATE TABLE IF NOT EXISTS uploaded_files (
                                file_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                                file_path VARCHAR(768) NOT NULL,
                                filename VARCHAR(255) NOT NULL,
                                original_filename VARCHAR(255) NULL,
                                content_type VARCHAR(255) NULL,
                                size_bytes BIGINT UNSIGNED NULL,
                                uploaded_by_user_id BIGINT UNSIGNED NULL,
                                metadata JSON NULL,
                                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                PRIMARY KEY (file_id),
                                UNIQUE KEY uq_uploaded_files_path (file_path),
                                KEY idx_uploaded_files_user (uploaded_by_user_id)
                            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                            """
                        )
                        cur.execute(
                            """
                            INSERT INTO uploaded_files (
                                file_path, filename, original_filename, content_type,
                                size_bytes, uploaded_by_user_id, metadata
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            ON DUPLICATE KEY UPDATE
                                filename = VALUES(filename),
                                original_filename = VALUES(original_filename),
                                content_type = VALUES(content_type),
                                size_bytes = VALUES(size_bytes),
                                uploaded_by_user_id = VALUES(uploaded_by_user_id)
                            """,
                            (
                                f"uploads/{safe_name}",
                                safe_name,
                                filename,
                                file.content_type,
                                total_size,
                                ctx.user_id,
                                json.dumps({}, ensure_ascii=False),
                            ),
                        )
                    conn.commit()
        except Exception:
            logger.debug("failed to persist upload ownership for %s", safe_name, exc_info=True)

    return {
        "status": "ok",
        "file_path": f"uploads/{safe_name}",
        "filename": filename,
    }


# ============================================================================
# Swarm API
# ============================================================================

_swarm_runtime = None


def _get_swarm_runtime():
    """Lazy-init SwarmRuntime singleton."""
    global _swarm_runtime
    if _swarm_runtime is not None:
        return _swarm_runtime
    from src.config import load_swarm_agent_config
    from src.swarm.store import SwarmStore
    from src.swarm.runtime import SwarmRuntime
    swarm_dir = Path(__file__).resolve().parent / ".swarm" / "runs"
    store = SwarmStore(base_dir=swarm_dir)
    # Boot-time / operator-trusted: REST API callers cannot influence the
    # config path. See docs/2026-05-25_swarm_mcp_tools_roadmap.md.
    agent_config = load_swarm_agent_config()
    _swarm_runtime = SwarmRuntime(store=store, agent_config=agent_config)
    return _swarm_runtime


@app.get("/swarm/presets")
async def list_swarm_presets():
    """List Swarm YAML presets."""
    from src.swarm.presets import list_presets
    return list_presets()


@app.post("/swarm/runs")
async def create_swarm_run(
    payload: dict,
    http_request: Request,
    ctx: AuthContext = Depends(require_auth),
):
    """Start a swarm run: body must include preset_name and user_vars."""
    runtime = _get_swarm_runtime()
    preset_name = payload.get("preset_name", "")
    user_vars = payload.get("user_vars", {})
    try:
        run = runtime.start_run(
            preset_name,
            user_vars,
            include_shell_tools=_shell_tools_enabled_for_request(http_request),
            owner_user_id=ctx.user_id,
        )
        return {"id": run.id, "status": run.status.value, "preset_name": run.preset_name}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/swarm/runs")
async def list_swarm_runs(limit: int = Query(20, ge=1, le=100), ctx: AuthContext = Depends(require_auth)):
    """List swarm runs (newest first), reconciled."""
    runtime = _get_swarm_runtime()
    runs = runtime._store.list_runs(limit=limit)
    items = []
    for r in runs:
        if not _swarm_run_belongs_to_context(r, ctx):
            continue
        # Reconcile each row: a zombie running run will be auto-finalized so
        # the dashboard never shows a permanent "running" stuck row.
        reconciled = runtime._store.reconcile_run(r, write=True)
        items.append(
            {
                "id": reconciled.id,
                "preset_name": reconciled.preset_name,
                "status": reconciled.status.value,
                "is_stale": runtime._store.is_run_stale(reconciled),
                "created_at": reconciled.created_at,
                "completed_at": reconciled.completed_at,
                "task_count": len(reconciled.tasks),
                "completed_count": sum(1 for t in reconciled.tasks if t.status.value == "completed"),
            }
        )
    return items


@app.get("/swarm/runs/{run_id}")
async def get_swarm_run(run_id: str, ctx: AuthContext = Depends(require_auth)):
    """Swarm run detail including task statuses (reconciled)."""
    _validate_path_param(run_id, "run_id")
    runtime = _get_swarm_runtime()
    loaded = runtime._store.load_run(run_id)
    if not loaded or not _swarm_run_belongs_to_context(loaded, ctx):
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = runtime._store.reconcile_run(loaded, write=True)

    return {
        "id": run.id,
        "preset_name": run.preset_name,
        "status": run.status.value,
        "is_stale": runtime._store.is_run_stale(run),
        "user_vars": run.user_vars,
        "agents": [a.model_dump() for a in run.agents],
        "tasks": [t.model_dump() for t in run.tasks],
        "created_at": run.created_at,
        "completed_at": run.completed_at,
        "final_report": run.final_report,
    }


@app.get("/swarm/runs/{run_id}/events")
async def swarm_run_events(
    run_id: str,
    request: Request,
    last_index: int = Query(0, ge=0),
    ctx: AuthContext = Depends(require_event_stream_auth),
):
    """SSE stream for a swarm run."""
    import asyncio

    _validate_path_param(run_id, "run_id")
    runtime = _get_swarm_runtime()
    loaded = runtime._store.load_run(run_id)
    if not loaded or not _swarm_run_belongs_to_context(loaded, ctx):
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    async def event_stream():
        idx = last_index
        while True:
            if await request.is_disconnected():
                break
            events = runtime._store.read_events(run_id, after_index=idx)
            for evt in events:
                idx += 1
                yield f"id: {idx}\nevent: {evt.type}\ndata: {json.dumps(evt.model_dump(), ensure_ascii=False)}\n\n"
            run = runtime._store.load_run(run_id)
            if run:
                # Reconcile so a zombie running run can still close this SSE
                # stream cleanly — without it, a dead host would keep the
                # stream open forever and block the dashboard's "done" state.
                reconciled = runtime._store.reconcile_run(run, write=True)
                if reconciled.status.value in ("completed", "failed", "cancelled"):
                    yield f"event: done\ndata: {{\"status\": \"{reconciled.status.value}\"}}\n\n"
                    break
            await asyncio.sleep(2)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/swarm/runs/{run_id}/cancel")
async def cancel_swarm_run(run_id: str, ctx: AuthContext = Depends(require_auth)):
    """Cancel an active swarm run."""
    _validate_path_param(run_id, "run_id")
    runtime = _get_swarm_runtime()
    loaded = runtime._store.load_run(run_id)
    if not loaded or not _swarm_run_belongs_to_context(loaded, ctx):
        raise HTTPException(status_code=404, detail=f"No active run {run_id}")
    ok = runtime.cancel_run(run_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"No active run {run_id}")
    return {"status": "cancelled"}


@app.post("/swarm/runs/{run_id}/retry")
async def retry_swarm_run(
    run_id: str,
    http_request: Request,
    ctx: AuthContext = Depends(require_auth),
):
    """Retry a failed, stale, or cancelled swarm run.

    Creates a new run with the same preset and user_vars as the original.
    """
    _validate_path_param(run_id, "run_id")
    runtime = _get_swarm_runtime()
    loaded = runtime._store.load_run(run_id)
    if not loaded or not _swarm_run_belongs_to_context(loaded, ctx):
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    # Reconcile first so a stale "running" run whose host died gets demoted
    # before we gate on status; only a genuinely active run blocks retry.
    from src.swarm.models import RunStatus

    reconciled = runtime._store.reconcile_run(loaded, write=True)
    if reconciled.status == RunStatus.running:
        raise HTTPException(status_code=409, detail="Cannot retry a running run. Cancel it first.")

    try:
        new_run = runtime.start_run(
            reconciled.preset_name,
            reconciled.user_vars or {},
            include_shell_tools=_shell_tools_enabled_for_request(http_request),
            owner_user_id=ctx.user_id,
        )
        return {"id": new_run.id, "status": new_run.status.value, "preset_name": new_run.preset_name}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# Live trading channel — consent commit + kill switch
# ============================================================================
#
# These are the privileged SURFACE actions of the live-trading channel
# (live-trading SPEC, Consent §1/§3/§4). None is an agent tool:
#   - POST /mandate/commit  -> the single mandate writer (commit_mandate)
#   - POST /live/halt       -> trip the kill switch (P5 trip_halt)
#   - POST /live/resume     -> clear the kill switch (P5 clear_halt)
# Each best-effort relays a mandate.committed / live.halted / live.action event
# through the EXISTING session EventBus, so the frontend's already-wired
# /sessions/{id}/events SSE stream reflects the state change. No new bus.


def _emit_live_event(session_id: Optional[str], event_type: str, data: Dict[str, Any]) -> None:
    """Best-effort relay of a live-channel event through the existing bus.

    The event flows out the existing ``/sessions/{session_id}/events`` SSE
    stream. Notifications never gate autonomy (SPEC Consent §5): a relay failure
    or a missing session is swallowed — the state change already happened on disk.

    Args:
        session_id: Target session, or ``None`` to skip relay.
        event_type: SSE event name (``mandate.committed`` / ``live.halted`` /
            ``live.resumed`` / ``live.action``).
        data: JSON-serializable event payload.
    """
    if not session_id:
        return
    try:
        svc = _get_session_service()
        if svc and svc.get_session(session_id):
            svc.event_bus.emit(session_id, event_type, data)
    except Exception:  # pragma: no cover - relay is non-blocking by contract
        logger.debug("live event relay failed for %s/%s", session_id, event_type, exc_info=True)


# ---- C1: propose_mandate_profiles tool_result -> mandate.proposal SSE frame ----
#
# The agent surfaces a proposal by calling the read-only ``propose_mandate_profiles``
# tool whose tool_result JSON body is ``{"type":"mandate.proposal", ...}`` (SPEC
# Consent §1). The CLI / frontend listen for a TOP-LEVEL ``mandate.proposal`` SSE
# event. ``src/agent/loop.py`` only emits a truncated ``tool_result`` event
# (``preview = result[:200]``) and is PROTECTED — we do NOT edit it. Instead this
# open-file SSE seam (TASKS "Remaining integration items" #1, the recommended
# wiring) detects the propose tool's tool_result on the stream, recovers the
# ``proposal_id`` from the preview, reloads the FULL persisted proposal from the
# proposal store (written by the tool before it returned), and emits the
# ``mandate.proposal`` frame. No protected touch.

_PROPOSAL_TOOL_NAME = "propose_mandate_profiles"
_PROPOSAL_ID_RE = re.compile(r'"proposal_id"\s*:\s*"(mp_[0-9a-zA-Z]+)"')


def _load_full_proposal(proposal_id: str) -> Optional[Dict[str, Any]]:
    """Reload a persisted ``mandate.proposal`` payload by id, broker-agnostic.

    The propose tool persists the full proposal under
    ``<runtime_root>/live/<broker>/proposals/<proposal_id>.json`` before
    returning. The SSE ``tool_result`` preview is too short to carry the full
    body, so the relay reloads it from disk. The broker segment is unknown from
    the preview alone, so every broker's proposals directory is searched.

    Args:
        proposal_id: The ``mp_...`` id parsed from the tool_result preview.

    Returns:
        The full proposal dict, or ``None`` when not found / unreadable.
    """
    try:
        from src.live.paths import live_root

        for proposal_path in live_root().glob(f"*/proposals/{proposal_id}.json"):
            try:
                data = json.loads(proposal_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(data, dict) and data.get("type") == "mandate.proposal":
                return data
    except Exception:  # pragma: no cover - relay must never break the stream
        logger.debug("mandate.proposal reload failed for %s", proposal_id, exc_info=True)
    return None


def _mandate_proposal_frame_from_tool_result(event: Any) -> Optional[str]:
    """Build a ``mandate.proposal`` SSE frame from a propose-tool tool_result.

    Args:
        event: An ``SSEEvent`` flowing through the session stream.

    Returns:
        A ready-to-yield SSE text frame for the ``mandate.proposal`` event, or
        ``None`` when ``event`` is not a successful propose-tool result or the
        proposal cannot be recovered.
    """
    data = getattr(event, "data", None)
    if getattr(event, "event_type", None) != "tool_result" or not isinstance(data, dict):
        return None
    if data.get("tool") != _PROPOSAL_TOOL_NAME or data.get("status") != "ok":
        return None
    match = _PROPOSAL_ID_RE.search(str(data.get("preview") or ""))
    if not match:
        return None
    proposal = _load_full_proposal(match.group(1))
    if proposal is None:
        return None

    from src.session.events import SSEEvent

    frame = SSEEvent(
        event_type="mandate.proposal",
        data=proposal,
        session_id=getattr(event, "session_id", "") or "",
    )
    return frame.to_sse()


_LIVE_ACTION_ID_RE = re.compile(r'"audit_id"\s*:\s*"(la_[0-9a-zA-Z]+)"')


def _load_live_action_record(audit_id: str) -> Optional[Dict[str, Any]]:
    """Reload a redacted live-action record from the ledger by ``audit_id``.

    The order guard embeds its (already-redacted) audit record under the
    ``live_action`` key of its tool_result, but the SSE ``tool_result`` preview
    is truncated to ~200 chars, so the full record is reloaded from the
    append-only ledger at ``<runtime_root>/live/audit.jsonl``.

    Args:
        audit_id: The ``la_...`` id parsed from the tool_result preview.

    Returns:
        The full redacted live-action record, or ``None`` when not found.
    """
    try:
        from src.live.paths import live_root

        ledger = live_root() / "audit.jsonl"
        if not ledger.exists():
            return None
        for line in reversed(ledger.read_text(encoding="utf-8").splitlines()):
            if audit_id not in line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict) and record.get("audit_id") == audit_id:
                return record
    except Exception:  # pragma: no cover - relay must never break the stream
        logger.debug("live.action reload failed for %s", audit_id, exc_info=True)
    return None


def _live_action_frame_from_tool_result(event: Any) -> Optional[str]:
    """Build a ``live.action`` SSE frame from an order-guard tool_result.

    The order guard stamps a ``live_action`` audit record onto its tool_result
    (and the ledger) for every live order placed/rejected. The interactive agent
    loop only emits a truncated ``tool_result`` event and is PROTECTED, so this
    open-file relay surfaces the live action as a top-level ``live.action`` event
    for the timeline — without touching ``src/agent/loop.py``. (Autonomous-runner
    actions already emit ``live.action`` natively via the runner's event bus.)

    Args:
        event: An ``SSEEvent`` flowing through the session stream.

    Returns:
        A ready-to-yield ``live.action`` SSE frame, or ``None`` when the event is
        not an order-guard result carrying a recoverable live-action record.
    """
    data = getattr(event, "data", None)
    if getattr(event, "event_type", None) != "tool_result" or not isinstance(data, dict):
        return None
    preview = str(data.get("preview") or "")
    if '"live_action"' not in preview:
        return None
    match = _LIVE_ACTION_ID_RE.search(preview)
    if not match:
        return None
    record = _load_live_action_record(match.group(1))
    if record is None:
        return None

    from src.session.events import SSEEvent

    frame = SSEEvent(
        event_type="live.action",
        data=record,
        session_id=getattr(event, "session_id", "") or "",
    )
    return frame.to_sse()


def _fetch_broker_ceilings(broker: str) -> Optional[Dict[str, Any]]:
    """Best-effort fetch of broker-side account ceilings for the commit re-check.

    Reads the broker's ``get_account`` tool and derives an authoritative ceiling
    snapshot (buying power / funding) so the commit-time fit check binds to the
    venue's real limits rather than an agent-proposed number. Returns ``None`` on
    any failure (channel not configured, tool error, fields not recognized) so
    the caller falls back to the proposal's own snapshot — a commit is never
    blocked on a broker read. The exact Robinhood field names are finalized
    post-access (L6); we probe the common ones.

    Args:
        broker: The live-broker key.

    Returns:
        A ceilings dict (canonical keys) or ``None`` to fall back.
    """
    try:
        adapter = _live_broker_adapter(broker)
    except LiveRunnerUnavailable:
        return None
    try:
        result = adapter.call_tool("get_account", {})
    except Exception:  # pragma: no cover - status/commit must never raise here
        logger.debug("broker ceiling fetch failed for %s", broker, exc_info=True)
        return None
    if not isinstance(result, dict) or result.get("status") == "error":
        return None
    payload = result.get("result") if isinstance(result.get("result"), dict) else result
    funding: Optional[float] = None
    for key in ("account_funding_usd", "buying_power", "cash", "portfolio_value", "equity"):
        raw = payload.get(key) if isinstance(payload, dict) else None
        try:
            if raw is not None:
                funding = float(raw)
                break
        except (TypeError, ValueError):
            continue
    if funding is None or funding <= 0:
        return None
    # A single order can never exceed available funding; total exposure is capped
    # at funding for a cash account. Leverage stays at 1.0 unless the broker
    # reports margin (L6). These canonical keys are normalized by commit_mandate.
    return {
        "account_funding_usd": funding,
        "max_order_notional_usd": funding,
        "max_total_exposure_usd": funding,
    }


@app.post("/mandate/commit", dependencies=[Depends(require_operator_auth)])
async def commit_mandate_endpoint(payload: CommitMandateRequest):
    """Commit a user-selected mandate profile — the only mandate write path.

    Calls :func:`src.live.mandate.commit.commit_mandate`, which re-validates the
    proposal is live and the resolved profile still fits the ceilings the user
    saw. Requires ``consent_ack=true`` (rejected otherwise). On success emits a
    ``mandate.committed`` + ``live.action`` event so all surfaces reflect the
    newly active mandate.
    """
    if payload.consent_ack is not True:
        raise HTTPException(status_code=400, detail="consent_ack must be true to commit a mandate")

    from src.live.mandate.commit import CommitError, commit_mandate

    # Prefer broker-DERIVED ceilings over the agent-supplied proposal snapshot:
    # the commit re-check should bind to the venue's real account limits, not a
    # number the model proposed. Best-effort — falls back to the proposal's own
    # ceilings (commit_mandate handles ceilings_ref=None) when the broker channel
    # is unavailable or the read fails (we never block a commit on a broker read).
    broker_ceilings = _fetch_broker_ceilings(payload.broker)

    try:
        result = commit_mandate(
            proposal_id=payload.proposal_id,
            ordinal=payload.selected_ordinal,
            adjustments=payload.adjustments,
            consent_ack=payload.consent_ack,
            broker=payload.broker,
            account_ref=payload.account_ref,
            session_id=payload.session_id,
            ceilings_ref=broker_ceilings,
            lifetime_days=payload.lifetime_days,
        )
    except CommitError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    _emit_live_event(payload.session_id, "mandate.committed", result)
    _emit_live_event(
        payload.session_id,
        "live.action",
        {"kind": "mandate_committed", "broker": result["broker"], "mandate_id": result["mandate_id"]},
    )
    return result


@app.post("/live/halt", dependencies=[Depends(require_operator_auth)])
async def halt_live_endpoint(payload: LiveHaltRequest):
    """Trip the live kill switch (privileged surface action, Consent §4).

    Writes the HALT sentinel via :func:`src.live.halt.trip_halt`; the
    enforcement gate then rejects every order attempt until resumed. Emits a
    ``live.halted`` event so all surfaces reflect the halted state.
    """
    from src.live.halt import trip_halt

    try:
        path = trip_halt(by="frontend", reason=payload.reason, broker=payload.broker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result = {"halted": True, "broker": payload.broker, "reason": payload.reason, "sentinel": str(path)}
    _emit_live_event(payload.session_id, "live.halted", result)
    _emit_live_event(
        payload.session_id,
        "live.action",
        {"kind": "halt_tripped", "broker": payload.broker, "reason": payload.reason},
    )
    return result


@app.post("/live/resume", dependencies=[Depends(require_operator_auth)])
async def resume_live_endpoint(payload: LiveHaltRequest):
    """Clear the live kill switch (privileged surface action, Consent §4).

    Deletes the HALT sentinel via :func:`src.live.halt.clear_halt` (an explicit
    re-enable; never an agent tool). Emits a ``live.resumed`` event.
    """
    from src.live.halt import clear_halt

    try:
        cleared = clear_halt(broker=payload.broker)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    result = {"halted": False, "broker": payload.broker, "cleared": cleared}
    _emit_live_event(payload.session_id, "live.resumed", result)
    _emit_live_event(
        payload.session_id,
        "live.action",
        {"kind": "halt_cleared", "broker": payload.broker, "cleared": cleared},
    )
    return result


# ============================================================================
# Live trading channel — status, authorize on-ramp, runner control (C2 + §7.5)
# ============================================================================
#
# C2 surfaces the dormant-by-default channel state so a user can SEE what is and
# is not authorized before trusting it: per-broker OAuth presence, the active
# mandate with its expiry countdown, runner liveness, and the kill-switch state.
# The runner-control endpoints start/stop the persistent §7.5 runner that trades
# autonomously inside a committed mandate. None of these is an agent tool; they
# are privileged surface actions like /mandate/commit and /live/halt.


def _known_live_brokers() -> List[str]:
    """Return the recognized live-broker keys (SPEC §7.2)."""
    from src.config.schema import LIVE_BROKER_SERVER_KEYS

    return sorted(set(LIVE_BROKER_SERVER_KEYS) | {"okx", "binance"})


def _save_crypto_live_connector_config(
    *,
    exchange: str,
    product_type: str,
    api_key: str,
    api_secret: str,
    passphrase: str = "",
    margin_mode: str = "cross",
    check_connection: bool = False,
) -> Dict[str, Any]:
    exchange = exchange.strip().lower()
    product_type = product_type.strip().lower()
    profile_id = f"{exchange}-live-trade"

    try:
        if exchange == "okx":
            from src.trading.connectors.okx import sdk as okx_sdk

            cfg = okx_sdk.OKXConfig.from_mapping(
                {
                    "api_key": api_key,
                    "api_secret": api_secret,
                    "passphrase": passphrase,
                    "profile": "live",
                    "product_type": product_type,
                    "margin_mode": margin_mode,
                }
            )
            okx_sdk.save_config(cfg)
        elif exchange == "binance":
            from src.trading.connectors.binance import sdk as binance_sdk

            cfg = binance_sdk.BinanceConfig.from_mapping(
                {
                    "api_key": api_key,
                    "api_secret": api_secret,
                    "profile": "live",
                    "product_type": product_type,
                }
            )
            binance_sdk.save_config(cfg)
        else:
            raise HTTPException(status_code=400, detail="exchange must be okx or binance")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    connection: Optional[Dict[str, Any]] = None
    if check_connection:
        from src.trading.service import check_connection

        connection = check_connection(profile_id)

    return {
        "status": "configured",
        "exchange": exchange,
        "product_type": product_type,
        "profile_id": profile_id,
        "config_path": f"connector://{profile_id}",
        "connection": connection,
    }


@app.post("/live/crypto/configure", response_model=CryptoLiveConfigureResponse)
async def configure_crypto_live_endpoint(
    payload: CryptoLiveConfigureRequest,
    _auth: None = Depends(require_live_credential_config_auth),
):
    """Persist user-supplied OKX/Binance live credentials for strategy trading.

    This endpoint intentionally does not place orders and does not create a
    mandate. Live order placement still goes through the existing live profile
    plus mandate gate. ``check_connection`` performs only read-only broker
    calls after saving.
    """

    return _save_crypto_live_connector_config(
        exchange=payload.exchange,
        product_type=payload.product_type,
        api_key=payload.api_key,
        api_secret=payload.api_secret,
        passphrase=payload.passphrase,
        margin_mode=payload.margin_mode,
        check_connection=payload.check_connection,
    )


def _oauth_token_present(broker: str) -> bool:
    """Return whether an OAuth token cache exists for a broker (C2 auth state).

    The token cache lives at ``<runtime_root>/live/<broker>/oauth/`` (0700) and
    is created only when the user OAuth-authorizes the channel. A missing or
    empty directory means the channel is dormant (read-only, no live path).
    """
    try:
        if broker == "okx":
            from src.trading.connectors.okx import sdk as okx_sdk

            cfg = okx_sdk.load_config()
            return not okx_sdk._missing_fields(cfg) and cfg.environment == "live"  # type: ignore[attr-defined]
        if broker == "binance":
            from src.trading.connectors.binance import sdk as binance_sdk

            cfg = binance_sdk.load_config()
            return not binance_sdk._missing_fields(cfg) and cfg.environment == "live"  # type: ignore[attr-defined]

        from src.live.paths import broker_dir

        oauth_dir = broker_dir(broker) / "oauth"
        return oauth_dir.is_dir() and any(oauth_dir.iterdir())
    except Exception:  # pragma: no cover - status must never raise
        logger.debug("oauth presence check failed for %s", broker, exc_info=True)
        return False


def _active_mandate_state(broker: str) -> Optional[ActiveMandateState]:
    """Build the active-mandate snapshot for a broker, or ``None`` when absent.

    Reads the committed mandate via the frozen store contract and computes the
    ``expires_at`` countdown (SPEC §9 dec. 2). A mandate whose ``expires_at`` has
    passed is still surfaced, flagged ``expired`` so the UI can prompt re-consent.
    """
    from src.live.mandate.store import load_mandate

    mandate = load_mandate(broker)
    if mandate is None:
        return None

    consent = mandate.consent
    caps = mandate.hard_caps
    expires_in: Optional[int] = None
    expired = False
    try:
        expires_dt = datetime.fromisoformat(consent.expires_at.replace("Z", "+00:00"))
        from datetime import timezone

        now = datetime.now(timezone.utc)
        if expires_dt.tzinfo is None:
            expires_dt = expires_dt.replace(tzinfo=timezone.utc)
        delta = expires_dt - now
        expires_in = int(delta.total_seconds())
        expired = expires_in <= 0
    except (ValueError, AttributeError):
        logger.debug("could not parse expires_at for %s mandate", broker, exc_info=True)

    return ActiveMandateState(
        broker=broker,
        account_ref=consent.account_ref,
        created_at=consent.created_at,
        expires_at=consent.expires_at,
        expires_in_seconds=expires_in,
        expired=expired,
        limits=MandateLimits(
            max_order_notional_usd=caps.max_order_notional_usd,
            max_total_exposure_usd=caps.max_total_exposure_usd,
            max_leverage=caps.max_leverage,
            max_trades_per_day=caps.max_trades_per_day,
            allowed_instruments=[str(getattr(i, "value", i)) for i in caps.allowed_instruments],
            account_funding_usd=caps.account_funding_usd,
        ),
    )


def _runner_liveness_state(broker: str) -> RunnerLivenessState:
    """Build the runner-liveness snapshot for a broker (SPEC §7.5 contract).

    Uses the §7.5 ``liveness`` module (``is_runner_alive`` / ``last_tick``),
    keyed by broker as the runner id. The module is built concurrently (R1); a
    missing module or any error is treated as "not alive" (fail-safe display).
    """
    alive = False
    tick: Optional[float] = None
    age: Optional[float] = None
    try:
        from src.live.runtime import liveness

        alive = bool(liveness.is_runner_alive(broker))
        raw_tick = liveness.last_tick(broker)
        if raw_tick is not None:
            tick = float(raw_tick)
            age = max(0.0, time.time() - tick)
    except Exception:  # pragma: no cover - liveness module is built concurrently
        logger.debug("runner liveness lookup failed for %s", broker, exc_info=True)

    return RunnerLivenessState(broker=broker, alive=alive, last_tick=tick, last_tick_age_seconds=age)


@app.get("/live/status", response_model=LiveStatusResponse, dependencies=[Depends(require_operator_auth)])
async def live_status_endpoint(broker: Optional[str] = Query(None, max_length=64)):
    """Return live-channel status: auth, active mandate, runner liveness, halt (C2).

    Args:
        broker: Optional single-broker filter. When omitted, every recognized
            live broker is reported.

    Returns:
        A :class:`LiveStatusResponse` with the global kill-switch state and a
        per-broker breakdown so the UI can show exactly what is authorized.
    """
    from src.live.halt import halt_flag_set

    if broker is not None:
        target = broker.strip().lower()
        if not target:
            raise HTTPException(status_code=400, detail="broker must not be blank")
        brokers = [target]
    else:
        brokers = _known_live_brokers()

    known = set(_known_live_brokers())
    statuses: List[LiveBrokerStatus] = []
    for key in brokers:
        statuses.append(
            LiveBrokerStatus(
                auth=BrokerAuthState(
                    broker=key,
                    oauth_token_present=_oauth_token_present(key),
                    is_live_broker=key in known,
                ),
                mandate=_active_mandate_state(key),
                runner=_runner_liveness_state(key),
                halted=halt_flag_set(broker=key),
            )
        )

    return LiveStatusResponse(global_halted=halt_flag_set(broker=None), brokers=statuses)


@app.post("/live/authorize", dependencies=[Depends(require_operator_auth)])
async def live_authorize_endpoint(payload: LiveAuthorizeRequest):
    """Describe the OAuth bootstrap on-ramp for a live broker (C2 web on-ramp).

    Vibe-Trading holds no funds and runs no venue: the OAuth flow happens on the
    broker's own user-authorized device channel (CLI / desktop MCP), never a
    server-side redirect. A Web UI user reaches this endpoint to DISCOVER how to
    start the flow. It performs no authorization itself and never returns a token.
    """
    broker = payload.broker.strip().lower()
    if not broker:
        raise HTTPException(status_code=400, detail="broker must not be blank")
    if broker not in set(_known_live_brokers()):
        raise HTTPException(status_code=400, detail=f"unknown live broker: {broker}")

    from src.trading.service import connector_profile_id_for_broker

    connector_profile = connector_profile_id_for_broker(broker)
    return {
        "broker": broker,
        "connector_profile": connector_profile,
        "oauth_token_present": _oauth_token_present(broker),
        "instruction": (
            f"Run `vibe-trading connector authorize {connector_profile}` "
            "from the device that will hold the broker session. This opens the "
            "broker's own OAuth consent flow; Vibe-Trading never holds funds and "
            "only relays intent once you authorize."
        ),
        "note": (
            "The live channel stays read-only until the OAuth token is present AND a "
            "mandate is committed AND order tools are explicitly enabled."
        ),
    }


# ---- Runner control (SPEC §7.5): start / stop the persistent live runner ----
#
# A LiveRunner (R2 contract: ``LiveRunner(broker)`` with ``run_loop()`` /
# ``run_once()``) is driven in a background task per broker. The factory is
# injectable (``_runner_factory``) so tests stub it with no real agent/broker.
# ``run_loop`` may be sync (long-blocking) or async; both are supported.

_runner_tasks: Dict[str, "asyncio.Task[Any]"] = {}
_runner_factory: Optional[Any] = None


class LiveRunnerUnavailable(RuntimeError):
    """Raised when a live runner cannot be wired (broker not configured/authorized).

    Distinct from a programming error so the start endpoint can map it to a 503
    rather than a 500: the runtime is fine, the broker channel just isn't ready.
    """


def _live_broker_adapter(broker: str) -> Any:
    """Build an ``MCPServerAdapter`` for a live broker from the user-side config.

    Resolves the broker's MCP server entry by config key OR by a live-broker URL
    host (so an aliased key still resolves), mirroring the registry's detection.

    Args:
        broker: The live-broker key, e.g. ``"robinhood"``.

    Returns:
        A constructed :class:`MCPServerAdapter` for the broker's read/write tools.

    Raises:
        LiveRunnerUnavailable: When no MCP server is configured for the broker.
    """
    from src.config.loader import load_agent_config
    from src.tools.mcp import MCPServerAdapter

    try:
        from src.config.schema import is_live_broker_entry
    except Exception:  # pragma: no cover - older schema without URL detection
        is_live_broker_entry = None  # type: ignore[assignment]

    cfg = load_agent_config()
    servers = getattr(cfg, "mcp_servers", {}) or {}
    for name, server_cfg in servers.items():
        is_match = name == broker
        if not is_match and is_live_broker_entry is not None and broker == "robinhood":
            try:
                is_match = is_live_broker_entry(name, server_cfg)
            except Exception:  # pragma: no cover
                is_match = False
        if is_match:
            return MCPServerAdapter(name, server_cfg)
    raise LiveRunnerUnavailable(f"no MCP server configured for live broker {broker!r}")


def _build_live_runner(broker: str) -> Any:
    """Construct a fully-wired ``LiveRunner`` for a broker (SPEC §7.5 R-INT).

    Wires the runner to the real surfaces — the public ``SessionService`` agent
    caller (never the protected loop internals), the broker's READ/WRITE MCP
    tools, the R4 reconciler, the R1 scheduler, and R3 market-hours triggers —
    and injects an audit ``event_callback`` so every autonomous live action is
    broadcast as a ``live.action`` SSE event on the runner's session bus.

    Args:
        broker: The live-broker key.

    Returns:
        A runner object exposing ``run_loop`` / ``run_once`` (R2 contract).

    Raises:
        LiveRunnerUnavailable: When the broker channel is not configured.
    """
    if _runner_factory is not None:
        return _runner_factory(broker)

    from src.live.audit import write_live_action
    from src.live.runtime.reconcile import reconcile
    from src.live.runtime.runner import LiveRunner
    from src.live.runtime.scheduler import Scheduler
    from src.live.runtime.triggers import Trigger
    from src.trading.service import runner_tool_name

    def _tool(operation: str) -> str:
        remote_tool = runner_tool_name(broker, operation)
        if remote_tool is None:
            raise LiveRunnerUnavailable(
                f"live runner for {broker!r} does not define remote tool {operation!r}"
            )
        return remote_tool

    positions_tool = _tool("positions")
    balance_tool = _tool("account")
    open_orders_tool = _tool("orders")
    submit_order_tool = _tool("submit_order")
    cancel_order_tool = _tool("cancel_order")
    adapter = _live_broker_adapter(broker)  # raises LiveRunnerUnavailable if absent

    def _read(remote_tool: str):
        """A zero-arg broker READ callable bound to one remote tool."""
        return lambda: adapter.call_tool(remote_tool, {})

    def _submit(order: Dict[str, Any]) -> Dict[str, Any]:
        # Route the flatten sweep's normalized order to the broker's write tools.
        # Field mapping against the real Robinhood schema is finalized post-access
        # (L6); the action discriminator is broker-agnostic.
        if order.get("action") == "cancel":
            return adapter.call_tool(cancel_order_tool, order)
        return adapter.call_tool(submit_order_tool, order)

    svc = _get_session_service()
    session = svc.create_session(title=f"live-runner:{broker}")
    session_id = session.session_id

    async def _agent_caller(sid: str, prompt: str) -> Dict[str, Any]:
        # Dispatch one autonomous turn through the PUBLIC SessionService entry.
        # The agent then trades within the mandate via the gated order tools.
        return await svc.send_message(sid, prompt)

    def _audit_with_bus(event: Any) -> Dict[str, Any]:
        # Broadcast each live action as a live.action SSE event on the runner's
        # session bus (no protected-loop touch — the runner owns its session).
        return write_live_action(
            event,
            event_callback=lambda etype, record: svc.event_bus.emit(session_id, etype, record),
        )

    # Wire the scheduler's fire callback to the runner's tick. The scheduler is
    # constructed before the runner (it needs on_fire), and the runner needs the
    # scheduler, so late-bind via a holder to break the cycle.
    runner_holder: Dict[str, Any] = {}

    async def _on_fire(_job: Any) -> None:
        runner = runner_holder.get("runner")
        if runner is not None:
            await runner.run_once(getattr(_job, "payload", None))

    scheduler = Scheduler(_on_fire)

    runner = LiveRunner(
        broker,
        agent_caller=_agent_caller,
        reconcile_fn=reconcile,
        read_positions=_read(positions_tool),
        read_balance=_read(balance_tool),
        read_open_orders=_read(open_orders_tool),
        submit_fn=_submit,
        write_audit_fn=_audit_with_bus,
        scheduler=scheduler,
        triggers=[Trigger.market("us_equity")],
        session_id=session_id,
    )
    runner_holder["runner"] = runner
    return runner


async def _drive_runner(runner: Any) -> None:
    """Run a runner's ``run_loop`` to completion, sync or async.

    A synchronous ``run_loop`` is offloaded to a worker thread so it does not
    block the event loop; an async ``run_loop`` is awaited directly.
    """
    result = runner.run_loop()
    if asyncio.iscoroutine(result):
        await result
    else:
        await asyncio.get_running_loop().run_in_executor(None, lambda: result)


@app.post("/live/runner/start", dependencies=[Depends(require_operator_auth)])
async def start_runner_endpoint(payload: LiveRunnerControlRequest):
    """Start the persistent live runner for a broker (SPEC §7.5).

    Refuses to start unless a committed, unexpired mandate exists and the kill
    switch is clear — the runner trades autonomously, so it must not start into a
    dead/halted channel. Idempotent: a request for an already-running broker
    returns ``already_running`` without spawning a second task.
    """
    from src.live.halt import halt_flag_set

    broker = payload.broker.strip().lower()
    if not broker:
        raise HTTPException(status_code=400, detail="broker must not be blank")
    from src.trading.service import broker_supports_live_runner

    if not broker_supports_live_runner(broker):
        raise HTTPException(
            status_code=400,
            detail=f"live runner is not supported for {broker}",
        )

    existing = _runner_tasks.get(broker)
    if existing is not None and not existing.done():
        return {"broker": broker, "started": False, "already_running": True}

    mandate = _active_mandate_state(broker)
    if mandate is None:
        raise HTTPException(status_code=409, detail=f"no committed mandate for {broker}")
    if mandate.expired:
        raise HTTPException(status_code=409, detail=f"mandate for {broker} has expired; re-authorize first")
    if halt_flag_set(broker=broker) or halt_flag_set(broker=None):
        raise HTTPException(status_code=409, detail="kill switch is tripped; resume before starting the runner")

    try:
        runner = _build_live_runner(broker)
    except LiveRunnerUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"could not construct runner: {exc}") from exc

    task = asyncio.ensure_future(_drive_runner(runner))
    _runner_tasks[broker] = task
    task.add_done_callback(
        lambda t, b=broker: _runner_tasks.pop(b, None) if _runner_tasks.get(b) is t else None
    )

    _emit_live_event(
        payload.session_id,
        "live.action",
        {"kind": "runner_started", "broker": broker},
    )
    return {"broker": broker, "started": True, "already_running": False}


@app.post("/live/runner/stop", dependencies=[Depends(require_operator_auth)])
async def stop_runner_endpoint(payload: LiveRunnerControlRequest):
    """Stop the persistent live runner for a broker (SPEC §7.5).

    Cancels the background task. This does NOT flatten positions — that is the
    preemptive kill switch's job (``/live/halt`` -> flatten); stopping the runner
    simply ceases new autonomous turns. Idempotent for an already-stopped broker.
    """
    broker = payload.broker.strip().lower()
    if not broker:
        raise HTTPException(status_code=400, detail="broker must not be blank")
    from src.trading.service import broker_supports_live_runner

    if not broker_supports_live_runner(broker):
        raise HTTPException(
            status_code=400,
            detail=f"live runner is not supported for {broker}",
        )

    task = _runner_tasks.pop(broker, None)
    if task is None or task.done():
        return {"broker": broker, "stopped": False, "was_running": False}

    task.cancel()
    _emit_live_event(
        payload.session_id,
        "live.action",
        {"kind": "runner_stopped", "broker": broker},
    )
    return {"broker": broker, "stopped": True, "was_running": True}


# ============================================================================
# Alpha Zoo routes (Web UI) — defined in src/api/alpha_routes.py
# ============================================================================

from src.api.alpha_routes import register_alpha_routes  # noqa: E402
register_alpha_routes(app)


# ============================================================================
# Main Entry Point
# ============================================================================

def serve_main(argv: list[str] | None = None) -> int:
    """Start the API server from CLI-style arguments."""
    import argparse
    import subprocess
    import uvicorn
    from fastapi.staticfiles import StaticFiles
    from starlette.exceptions import HTTPException as StarletteHTTPException

    class SPAStaticFiles(StaticFiles):
        """Serve index.html for browser refreshes on client-side routes."""

        async def get_response(self, path: str, scope: Dict[str, Any]):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code != status.HTTP_404_NOT_FOUND:
                    raise
                return await super().get_response("index.html", scope)

    parser = argparse.ArgumentParser(description="Vibe-Trading Server")
    parser.add_argument("--port", type=int, default=8000, help="Listen port (default 8000)")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--dev", action="store_true", help="Dev mode: spawn Vite on :5173")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code) if isinstance(exc.code, int) else 2

    frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    frontend_root = Path(__file__).resolve().parent.parent / "frontend"

    vite_proc = None
    if args.dev and frontend_root.exists():
        print("[dev] Starting Vite dev server on :5173 ...")
        vite_proc = subprocess.Popen(
            ["npx", "vite", "--host", "0.0.0.0"],
            cwd=str(frontend_root),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print(f"[dev] Vite PID={vite_proc.pid}")
        print("[dev] Frontend: http://localhost:5173")
        print(f"[dev] API: http://localhost:{args.port}")
    elif frontend_dist.exists():
        if not any(route.path == "/" for route in app.routes):
            app.mount("/", SPAStaticFiles(directory=str(frontend_dist), html=True), name="frontend")
        print(f"[prod] Frontend served from {frontend_dist}")
    else:
        print(f"[warn] No frontend build found at {frontend_dist}")
        print("[warn] Run: cd frontend && npm run build")

    print("=" * 50)
    print("  Vibe-Trading Server")
    print(f"  http://127.0.0.1:{args.port}")
    print("=" * 50)

    try:
        uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    finally:
        if vite_proc:
            vite_proc.terminate()
            print("[dev] Vite stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(serve_main())
