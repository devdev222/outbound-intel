-- Generic document collections for the platform modules (reps, users, conversations,
-- experiments, proof stories, gift campaigns, gifts, assessments, settings, suppressions,
-- audit log). One jsonb table keeps the schema stable while modules evolve; promote a
-- collection to its own table when it needs relational queries.

create table if not exists documents (
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table documents enable row level security;
create index if not exists idx_documents_collection on documents(collection, updated_at desc);

-- Account columns used by the readiness engine and the BDR queue live in the accounts jsonb-friendly columns;
-- add the new scalar ones explicitly.
alter table accounts add column if not exists owner_rep_id text;
alter table accounts add column if not exists readiness jsonb;
alter table accounts add column if not exists next_action jsonb;
alter table accounts add column if not exists experiments jsonb not null default '{}'::jsonb;
alter table accounts add column if not exists pipeline_value numeric;
alter table accounts add column if not exists crm_owner text;
