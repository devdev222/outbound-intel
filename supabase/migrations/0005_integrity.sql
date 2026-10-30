-- Data integrity: wrong-contact handling, persistent idempotency, durable CRM sync.

-- Contacts a rep marked wrong, and the hold on contact-specific outreach.
alter table accounts add column if not exists rejected_contacts jsonb not null default '[]'::jsonb;
alter table accounts add column if not exists contact_hold jsonb;

-- Compare-and-swap writes (patchAccount) compare updated_at; make sure it is indexed with id.
create index if not exists idx_accounts_id_updated on accounts(id, updated_at);

-- operations.kind now also carries:
--   request   : idempotency records for webhook deliveries, conversation submissions,
--               outcome writes and MCP/machine mutations (id = idem:<scope>:<hash>)
--   crm_sync  : durable CRM write-back, one per outcome (id = crm:<outcome id>)
create index if not exists idx_operations_kind_status on operations(kind, status);

insert into app_meta (key, value) values ('schema_version', '5')
  on conflict (key) do update set value = excluded.value, updated_at = now();
