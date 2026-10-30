-- Per-account activity (team audit trail) and rep-task fields on outreach touches.

create table if not exists account_activity (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  actor text not null,          -- agent id | system | rep | webhook
  action text not null,         -- e.g. signals_updated, score_updated, video_submitted, rep_task_done
  summary text not null,
  details jsonb not null default '[]'::jsonb,
  at timestamptz not null default now()
);
alter table account_activity enable row level security;
create index if not exists idx_activity_account on account_activity(account_id, at desc);

alter table outreach_touches add column if not exists note text;
alter table outreach_touches add column if not exists task_url text;
-- status now also takes: awaiting_rep | failed
create index if not exists idx_outreach_due on outreach_touches(status, scheduled_for);
