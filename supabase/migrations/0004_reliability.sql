-- Reliability MVP: complete account state, explicit pauses, task lifecycle,
-- durable operations with idempotency keys, per-destination deliveries,
-- canonical opportunity ids, and a schema version the app checks at startup.

-- Accounts: state that previously only survived in file/memory mode.
alter table accounts add column if not exists owner_rep_id text;
alter table accounts add column if not exists readiness jsonb;
alter table accounts add column if not exists next_action jsonb;
alter table accounts add column if not exists experiments jsonb not null default '{}'::jsonb;
alter table accounts add column if not exists pipeline_value numeric;
alter table accounts add column if not exists crm_owner text;
alter table accounts add column if not exists pending_activation_at timestamptz;
alter table accounts add column if not exists paused_until timestamptz;
alter table accounts add column if not exists pause_reason text;
alter table accounts add column if not exists enrichment jsonb;
create index if not exists idx_accounts_owner on accounts(owner_rep_id);
create index if not exists idx_accounts_paused on accounts(paused_until) where paused_until is not null;

-- Tasks (outreach_touches) as the one authoritative task record.
-- status: awaiting_approval | scheduled | sending | sent | manual | done | skipped | failed
update outreach_touches set status = 'manual' where status = 'awaiting_rep';
alter table outreach_touches add column if not exists title text;
alter table outreach_touches add column if not exists source text;
alter table outreach_touches add column if not exists assignee_rep_id text;
alter table outreach_touches add column if not exists attempts integer not null default 0;
alter table outreach_touches add column if not exists last_error text;
alter table outreach_touches add column if not exists approved_by text;
alter table outreach_touches add column if not exists approved_at timestamptz;
alter table outreach_touches add column if not exists completed_by text;
alter table outreach_touches add column if not exists completion_mode text;
alter table outreach_touches add column if not exists conversation_id text;
create index if not exists idx_outreach_assignee on outreach_touches(assignee_rep_id, status);

-- Per-destination alert deliveries.
alter table alerts add column if not exists deliveries jsonb not null default '[]'::jsonb;

-- Canonical opportunity identity (created -> won share one id).
alter table outcomes add column if not exists opportunity_id text;
create index if not exists idx_outcomes_opportunity on outcomes(opportunity_id);

-- Durable operations: one row per external side effect, keyed by a stable idempotency key.
-- Workers claim with a conditional UPDATE (status pending/failed or an expired lease).
create table if not exists operations (
  id text primary key,
  kind text not null,                -- sequence_launch | send | alert | dialer | sequence_pause | lease
  account_id uuid references accounts(id) on delete cascade,
  destination text not null,
  status text not null default 'pending', -- pending | running | succeeded | failed | dead
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner text,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  remote_id text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table operations enable row level security;
create index if not exists idx_operations_status on operations(status, next_attempt_at);
create index if not exists idx_operations_account on operations(account_id, updated_at desc);

-- Schema version the app verifies (GET /api/health, npm run check).
create table if not exists app_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table app_meta enable row level security;
insert into app_meta (key, value) values ('schema_version', '4')
  on conflict (key) do update set value = excluded.value, updated_at = now();
