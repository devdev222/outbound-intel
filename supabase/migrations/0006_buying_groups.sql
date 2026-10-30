-- Buying groups: several people per account, each with an independent lifecycle,
-- and stable contact ids on tasks, outcomes and CRM sync.

create table if not exists contacts (
  id text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  role text not null,                 -- economic_buyer | operational_owner | champion | supporting
  status text not null,               -- candidate | selected | paused | rejected | replaced | opted_out
  email text,
  name text not null,
  data jsonb not null,                -- full BuyingContact (person, verification, outreach, engagement, provenance)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table contacts enable row level security;
create index if not exists idx_contacts_account on contacts(account_id, status);
create index if not exists idx_contacts_email on contacts(lower(email));
create index if not exists idx_contacts_id_updated on contacts(id, updated_at);

alter table accounts add column if not exists buying_group jsonb;
alter table accounts add column if not exists primary_contact_id text;

alter table outreach_touches add column if not exists contact_id text;
create index if not exists idx_outreach_contact on outreach_touches(contact_id);
alter table outcomes add column if not exists contact_id text;

alter table historical_accounts add column if not exists contacts jsonb;
alter table scoring_models add column if not exists buying_group jsonb;

insert into app_meta (key, value) values ('schema_version', '6')
  on conflict (key) do update set value = excluded.value, updated_at = now();
