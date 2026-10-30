-- Outbound Intelligence Engine: initial schema.
--
-- Differences from the MVP spec's draft schema, on purpose:
--  * total_score is a plain column written by the Scoring Agent. The spec had a
--    generated column with hard-coded weights (0.30/0.25/...), which contradicts
--    the learning loop: weights change per model version and live in
--    scoring_models.weights.
--  * facts / signals / contact / campaign are jsonb so agents can learn to
--    extract new facts without a migration.
--  * Added: historical_accounts (training data), scoring_models (versioned),
--    alerts, call_queue, outreach_touches, agent_runs, agent_state.
--  * RLS is enabled on every table with no policies: only the service-role /
--    secret key used by the server can read or write. The browser never talks
--    to the database directly; everything goes through the API routes.

create extension if not exists pgcrypto;

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  company_name text not null,
  company_domain text,
  industry text,
  employee_count integer,
  hq_city text,
  hq_state text,

  facts jsonb not null default '{}'::jsonb,
  facts_updated_at timestamptz not null default now(),
  signals jsonb not null default '[]'::jsonb,

  -- scoring (written by the Scoring Agent with the current model's weights)
  icp_score integer,
  signal_score integer,
  pain_score integer,
  timing_score integer,
  access_score integer,
  total_score integer,
  score_explanation text,
  verified_signals jsonb not null default '[]'::jsonb,
  hypotheses jsonb not null default '[]'::jsonb,
  missing_info jsonb not null default '[]'::jsonb,
  pain_hypothesis text,
  messaging_angle text,
  recommended_persona text,
  brief text,

  -- contact + campaign
  contact jsonb,
  campaign jsonb,

  -- engagement / status
  engagement_score integer not null default 0,
  priority integer not null default 0,
  status text not null default 'discovered',
  model_version integer,
  last_alert_at timestamptz,
  pending_activation text,
  agent_runs jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists historical_accounts (
  id text primary key,
  company_name text not null,
  industry text,
  employee_count integer,
  signal_keys jsonb not null default '[]'::jsonb,
  persona text,
  seniority text,
  messaging_angle text,
  outcome text not null, -- won | lost | meeting | no_response
  deal_value numeric,
  first_touch_at timestamptz,
  outcome_at timestamptz,
  source text not null default 'crm_export' -- crm_export | loop
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  event_type text not null,
  properties jsonb not null default '{}'::jsonb,
  visitor_id text,
  created_at timestamptz not null default now()
);

create table if not exists outcomes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  outcome_type text not null, -- replied | meeting_booked | opportunity_created | deal_won | deal_lost | no_response | disqualified
  outcome_value numeric,
  notes text,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists scoring_models (
  version integer primary key,
  trained_at timestamptz not null default now(),
  weights jsonb not null,
  prior_weights jsonb not null,
  category_correlations jsonb not null,
  signal_patterns jsonb not null default '[]'::jsonb,
  icp jsonb not null,
  playbook jsonb not null,
  baseline jsonb not null,
  notes jsonb not null default '[]'::jsonb
);

-- Flattened mirror of the latest model's signal patterns (spec table), for analysts / BI.
create table if not exists signal_patterns (
  id uuid primary key default gen_random_uuid(),
  signal_type text not null,
  signal_value text not null,
  label text,
  conversion_rate numeric,
  baseline_rate numeric,
  lift numeric,
  weight numeric,
  sample_size integer,
  model_version integer,
  last_updated timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  delivered_via jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists call_queue (
  id text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  contact_name text,
  phone text,
  context text,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

create table if not exists outreach_touches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  channel text not null,
  step integer not null,
  subject text,
  body text not null,
  status text not null default 'scheduled',
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  provider text,
  external_id text
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  processed integer not null default 0,
  summary text,
  details jsonb not null default '[]'::jsonb,
  error text
);

create table if not exists agent_state (
  agent_id text primary key,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  total_runs integer not null default 0,
  total_processed integer not null default 0
);

-- Row Level Security: on everywhere, no policies => service role only.
alter table accounts enable row level security;
alter table historical_accounts enable row level security;
alter table events enable row level security;
alter table outcomes enable row level security;
alter table scoring_models enable row level security;
alter table signal_patterns enable row level security;
alter table alerts enable row level security;
alter table call_queue enable row level security;
alter table outreach_touches enable row level security;
alter table agent_runs enable row level security;
alter table agent_state enable row level security;

-- Indexes
create index if not exists idx_accounts_slug on accounts(slug);
create index if not exists idx_accounts_priority on accounts(priority desc);
create index if not exists idx_accounts_total on accounts(total_score desc);
create index if not exists idx_accounts_status on accounts(status);
create index if not exists idx_accounts_pending on accounts(pending_activation) where pending_activation is not null;
create index if not exists idx_events_account on events(account_id, created_at desc);
create index if not exists idx_events_type on events(event_type);
create index if not exists idx_events_visitor on events(visitor_id);
create index if not exists idx_outcomes_account on outcomes(account_id);
create index if not exists idx_outcomes_created on outcomes(created_at desc);
create index if not exists idx_alerts_account on alerts(account_id, created_at desc);
create index if not exists idx_outreach_account on outreach_touches(account_id, scheduled_for);
create index if not exists idx_agent_runs_agent on agent_runs(agent_id, started_at desc);
create index if not exists idx_historical_outcome on historical_accounts(outcome);
