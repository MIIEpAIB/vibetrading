-- Vibe-Trading MySQL schema.
-- This prepares relational storage for all current durable entities.
-- Existing code still uses filesystem/SQLite for some stores until the
-- persistence adapters are switched to MySQL.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(128) NOT NULL,
  setting_value JSON NULL,
  value_text LONGTEXT NULL,
  is_secret TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(191) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  password_hash VARCHAR(512) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  last_used_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  PRIMARY KEY (token_id),
  UNIQUE KEY uq_auth_tokens_hash (token_hash),
  KEY idx_auth_tokens_user (user_id),
  KEY idx_auth_tokens_expires (expires_at),
  CONSTRAINT fk_auth_tokens_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS strategy_library (
  id VARCHAR(128) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  language VARCHAR(32) NOT NULL,
  category VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  tags_json JSON NOT NULL,
  code MEDIUMTEXT NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (user_id, id),
  KEY idx_strategy_user_updated (user_id, updated_at),
  KEY idx_strategy_updated_at (updated_at),
  KEY idx_strategy_status (status),
  KEY idx_strategy_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assistant_prompts (
  prompt_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_session_id VARCHAR(64) NULL,
  strategy_id VARCHAR(128) NULL,
  strategy_user_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  prompt LONGTEXT NOT NULL,
  category VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (prompt_id),
  KEY idx_assistant_prompts_session_created (owner_session_id, created_at),
  KEY idx_assistant_prompts_strategy (strategy_user_id, strategy_id),
  CONSTRAINT fk_assistant_prompts_strategy
    FOREIGN KEY (strategy_user_id, strategy_id) REFERENCES strategy_library(user_id, id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uploaded_files (
  file_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_path VARCHAR(768) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NULL,
  content_type VARCHAR(255) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  sha256 CHAR(64) NULL,
  uploaded_by_session_id VARCHAR(64) NULL,
  uploaded_by_user_id BIGINT UNSIGNED NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (file_id),
  UNIQUE KEY uq_uploaded_files_path (file_path),
  KEY idx_uploaded_files_session (uploaded_by_session_id),
  KEY idx_uploaded_files_user (uploaded_by_user_id),
  KEY idx_uploaded_files_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(64) PRIMARY KEY,
  title TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  last_attempt_id VARCHAR(64) NULL,
  user_id BIGINT UNSIGNED NULL,
  config_json JSON NOT NULL,
  KEY idx_sessions_user_updated (user_id, updated_at),
  KEY idx_sessions_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  linked_attempt_id VARCHAR(64) NULL,
  metadata_json JSON NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_session_messages_message_id (message_id),
  KEY idx_messages_session_created (session_id, id),
  CONSTRAINT fk_session_messages_session
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS session_attempts (
  attempt_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  parent_attempt_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  prompt MEDIUMTEXT NOT NULL,
  run_dir TEXT NULL,
  summary MEDIUMTEXT NULL,
  react_trace_json JSON NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  completed_at VARCHAR(64) NULL,
  error MEDIUMTEXT NULL,
  metrics_json JSON NULL,
  PRIMARY KEY (attempt_id),
  KEY idx_session_attempts_session_created (session_id, created_at),
  CONSTRAINT fk_session_attempts_session
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runs (
  run_id VARCHAR(128) NOT NULL,
  session_id VARCHAR(64) NULL,
  attempt_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  stage VARCHAR(64) NULL,
  prompt LONGTEXT NULL,
  reason LONGTEXT NULL,
  created_at DATETIME(6) NULL,
  started_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  elapsed_seconds DOUBLE NULL,
  run_directory VARCHAR(768) NULL,
  request_json JSON NULL,
  planner_output JSON NULL,
  strategy_spec JSON NULL,
  rag_selection JSON NULL,
  metrics JSON NULL,
  run_card JSON NULL,
  validation JSON NULL,
  run_context JSON NULL,
  price_series JSON NULL,
  indicator_series JSON NULL,
  trade_markers JSON NULL,
  logs JSON NULL,
  raw_state JSON NULL,
  created_record_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_record_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id),
  KEY idx_runs_session_created (session_id, created_at),
  KEY idx_runs_attempt (attempt_id),
  KEY idx_runs_status_created (status, created_at),
  CONSTRAINT fk_runs_session
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_runs_attempt
    FOREIGN KEY (attempt_id) REFERENCES session_attempts(attempt_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS run_artifacts (
  artifact_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  artifact_path VARCHAR(512) NOT NULL,
  artifact_type VARCHAR(64) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  sha256 CHAR(64) NULL,
  preview_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (artifact_id),
  UNIQUE KEY uq_run_artifacts_run_path (run_id, artifact_path),
  KEY idx_run_artifacts_type (artifact_type),
  CONSTRAINT fk_run_artifacts_run
    FOREIGN KEY (run_id) REFERENCES runs(run_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS goals (
  goal_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  objective LONGTEXT NOT NULL,
  ui_summary TEXT NOT NULL,
  source VARCHAR(64) NOT NULL,
  protocol VARCHAR(128) NOT NULL,
  risk_tier VARCHAR(128) NOT NULL,
  token_budget INT NULL,
  tokens_used INT NOT NULL DEFAULT 0,
  turn_budget INT NULL,
  turns_used INT NOT NULL DEFAULT 0,
  time_budget_seconds INT NULL,
  time_used_seconds INT NOT NULL DEFAULT 0,
  budget_wrapup_sent TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  recap LONGTEXT NULL,
  PRIMARY KEY (goal_id),
  KEY idx_goals_session_status (session_id, status),
  KEY idx_goals_updated (updated_at),
  CONSTRAINT fk_goals_session
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS goal_claims (
  claim_id VARCHAR(64) NOT NULL,
  goal_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  claim_type VARCHAR(64) NOT NULL,
  text LONGTEXT NOT NULL,
  status VARCHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (claim_id),
  KEY idx_goal_claims_goal_status (goal_id, status),
  KEY idx_goal_claims_session (session_id),
  CONSTRAINT fk_goal_claims_goal
    FOREIGN KEY (goal_id) REFERENCES goals(goal_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_goal_claims_session
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS goal_criteria (
  criterion_id VARCHAR(64) NOT NULL,
  goal_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  text LONGTEXT NOT NULL,
  required TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(64) NOT NULL DEFAULT 'pending',
  freshness_requirement VARCHAR(255) NULL,
  protocol_step VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (criterion_id),
  KEY idx_goal_criteria_goal_status (goal_id, status),
  KEY idx_goal_criteria_session (session_id),
  CONSTRAINT fk_goal_criteria_goal
    FOREIGN KEY (goal_id) REFERENCES goals(goal_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_goal_criteria_session
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS goal_evidence (
  evidence_id VARCHAR(64) NOT NULL,
  goal_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  criterion_id VARCHAR(64) NULL,
  claim_id VARCHAR(64) NULL,
  evidence_type VARCHAR(64) NOT NULL DEFAULT 'evidence',
  text LONGTEXT NOT NULL,
  tool_call_id VARCHAR(128) NULL,
  run_id VARCHAR(128) NULL,
  source_provider VARCHAR(128) NULL,
  source_type VARCHAR(128) NULL,
  source_uri TEXT NULL,
  symbol_universe_json JSON NOT NULL,
  benchmark_json JSON NOT NULL,
  timeframe VARCHAR(128) NULL,
  method TEXT NULL,
  assumptions_json JSON NOT NULL,
  artifact_path VARCHAR(768) NULL,
  artifact_hash VARCHAR(128) NULL,
  retrieved_at DATETIME(6) NOT NULL,
  data_as_of VARCHAR(128) NULL,
  freshness_status VARCHAR(64) NOT NULL DEFAULT 'unknown',
  verification_status VARCHAR(64) NOT NULL DEFAULT 'unverified',
  confidence VARCHAR(64) NULL,
  caveat TEXT NULL,
  contradicts_claim_ids_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (evidence_id),
  KEY idx_goal_evidence_goal_created (goal_id, created_at),
  KEY idx_goal_evidence_session (session_id),
  KEY idx_goal_evidence_criterion (criterion_id),
  KEY idx_goal_evidence_claim (claim_id),
  KEY idx_goal_evidence_run (run_id),
  CONSTRAINT fk_goal_evidence_goal
    FOREIGN KEY (goal_id) REFERENCES goals(goal_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_goal_evidence_session
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_goal_evidence_criterion
    FOREIGN KEY (criterion_id) REFERENCES goal_criteria(criterion_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_goal_evidence_claim
    FOREIGN KEY (claim_id) REFERENCES goal_claims(claim_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS goal_audits (
  audit_id VARCHAR(64) NOT NULL,
  goal_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  audit_type VARCHAR(64) NOT NULL,
  result VARCHAR(64) NOT NULL,
  rows_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (audit_id),
  KEY idx_goal_audits_goal_created (goal_id, created_at),
  KEY idx_goal_audits_session (session_id),
  CONSTRAINT fk_goal_audits_goal
    FOREIGN KEY (goal_id) REFERENCES goals(goal_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_goal_audits_session
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS swarm_runs (
  swarm_run_id VARCHAR(128) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  owner_session_id VARCHAR(64) NULL,
  preset_name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  user_vars JSON NULL,
  agents JSON NULL,
  tasks JSON NULL,
  created_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  final_report LONGTEXT NULL,
  total_input_tokens INT NOT NULL DEFAULT 0,
  total_output_tokens INT NOT NULL DEFAULT 0,
  provider VARCHAR(64) NULL,
  model VARCHAR(255) NULL,
  grounding_data JSON NULL,
  raw_run JSON NULL,
  PRIMARY KEY (swarm_run_id),
  KEY idx_swarm_runs_user_created (user_id, created_at),
  KEY idx_swarm_runs_session_created (owner_session_id, created_at),
  KEY idx_swarm_runs_status_created (status, created_at),
  KEY idx_swarm_runs_preset_created (preset_name, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS swarm_tasks (
  swarm_run_id VARCHAR(128) NOT NULL,
  task_id VARCHAR(128) NOT NULL,
  agent_id VARCHAR(128) NOT NULL,
  prompt_template LONGTEXT NOT NULL,
  depends_on JSON NOT NULL,
  blocked_by JSON NOT NULL,
  input_from JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  summary LONGTEXT NULL,
  artifacts JSON NOT NULL,
  error LONGTEXT NULL,
  started_at DATETIME(6) NULL,
  completed_at DATETIME(6) NULL,
  worker_iterations INT NOT NULL DEFAULT 0,
  raw_task JSON NULL,
  PRIMARY KEY (swarm_run_id, task_id),
  KEY idx_swarm_tasks_status (status),
  CONSTRAINT fk_swarm_tasks_run
    FOREIGN KEY (swarm_run_id) REFERENCES swarm_runs(swarm_run_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS swarm_events (
  event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  swarm_run_id VARCHAR(128) NOT NULL,
  event_index INT UNSIGNED NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  agent_id VARCHAR(128) NULL,
  task_id VARCHAR(128) NULL,
  data JSON NULL,
  timestamp DATETIME(6) NOT NULL,
  raw_event JSON NULL,
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_swarm_events_run_index (swarm_run_id, event_index),
  KEY idx_swarm_events_run_timestamp (swarm_run_id, timestamp),
  CONSTRAINT fk_swarm_events_run
    FOREIGN KEY (swarm_run_id) REFERENCES swarm_runs(swarm_run_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hypotheses (
  hypothesis_id VARCHAR(64) NOT NULL,
  title VARCHAR(512) NOT NULL,
  thesis LONGTEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'exploring',
  universe TEXT NULL,
  signal_definition LONGTEXT NULL,
  data_sources JSON NOT NULL,
  skills JSON NOT NULL,
  run_cards JSON NOT NULL,
  invalidation_notes LONGTEXT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (hypothesis_id),
  KEY idx_hypotheses_status_updated (status, updated_at),
  FULLTEXT KEY ftx_hypotheses_text (title, thesis, signal_definition, invalidation_notes)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shadow_profiles (
  shadow_id VARCHAR(64) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  journal_hash CHAR(40) NOT NULL,
  source_market VARCHAR(64) NOT NULL,
  profitable_roundtrips INT NOT NULL,
  total_roundtrips INT NOT NULL,
  date_start VARCHAR(64) NULL,
  date_end VARCHAR(64) NULL,
  profile_text LONGTEXT NOT NULL,
  preferred_markets JSON NOT NULL,
  typical_holding_days JSON NOT NULL,
  raw_profile JSON NULL,
  PRIMARY KEY (shadow_id),
  KEY idx_shadow_profiles_journal_hash (journal_hash),
  KEY idx_shadow_profiles_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shadow_rules (
  shadow_id VARCHAR(64) NOT NULL,
  rule_id VARCHAR(64) NOT NULL,
  human_text VARCHAR(255) NOT NULL,
  entry_condition JSON NOT NULL,
  exit_condition JSON NOT NULL,
  holding_days_range JSON NOT NULL,
  support_count INT NOT NULL,
  coverage_rate DOUBLE NOT NULL,
  sample_trades JSON NOT NULL,
  weight DOUBLE NOT NULL DEFAULT 1.0,
  PRIMARY KEY (shadow_id, rule_id),
  CONSTRAINT fk_shadow_rules_profile
    FOREIGN KEY (shadow_id) REFERENCES shadow_profiles(shadow_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shadow_runs (
  shadow_run_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shadow_id VARCHAR(64) NOT NULL,
  run_id VARCHAR(128) NULL,
  run_dir VARCHAR(768) NULL,
  per_market JSON NULL,
  combined JSON NULL,
  equity_curves JSON NULL,
  attribution JSON NULL,
  shadow_total_pnl DOUBLE NULL,
  real_total_pnl DOUBLE NULL,
  delta_pnl DOUBLE NULL,
  raw_result JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (shadow_run_id),
  KEY idx_shadow_runs_shadow_created (shadow_id, created_at),
  KEY idx_shadow_runs_run_id (run_id),
  CONSTRAINT fk_shadow_runs_profile
    FOREIGN KEY (shadow_id) REFERENCES shadow_profiles(shadow_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trading_connections (
  connection_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  selected_profile VARCHAR(128) NULL,
  connector VARCHAR(64) NULL,
  profile_id VARCHAR(128) NULL,
  environment VARCHAR(64) NULL,
  transport VARCHAR(64) NULL,
  config_json JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (connection_id),
  KEY idx_trading_connections_profile (profile_id),
  KEY idx_trading_connections_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS live_mandates (
  mandate_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  broker VARCHAR(64) NOT NULL,
  schema_version INT NOT NULL,
  hard_caps JSON NOT NULL,
  universe JSON NOT NULL,
  consent JSON NOT NULL,
  flatten_on_halt TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at VARCHAR(128) NULL,
  raw_mandate JSON NOT NULL,
  PRIMARY KEY (mandate_id),
  KEY idx_live_mandates_broker_active (broker, active),
  KEY idx_live_mandates_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS live_audit_events (
  audit_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  broker VARCHAR(64) NULL,
  session_id VARCHAR(64) NULL,
  event_type VARCHAR(128) NOT NULL,
  status VARCHAR(64) NULL,
  order_ref VARCHAR(255) NULL,
  symbol VARCHAR(128) NULL,
  side VARCHAR(32) NULL,
  notional DOUBLE NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_event_id),
  KEY idx_live_audit_broker_created (broker, created_at),
  KEY idx_live_audit_session_created (session_id, created_at),
  KEY idx_live_audit_type_created (event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS live_runtime_jobs (
  job_id VARCHAR(128) NOT NULL,
  broker VARCHAR(64) NOT NULL,
  job_type VARCHAR(128) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'active',
  schedule_json JSON NULL,
  payload JSON NULL,
  next_run_at DATETIME(6) NULL,
  last_run_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (job_id),
  KEY idx_live_jobs_broker_status (broker, status),
  KEY idx_live_jobs_next_run (next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
