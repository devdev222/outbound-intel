# Wiring plan: from mock adapters to the real systems

Every external system sits behind an interface in `lib/providers/types.ts`.
The engine, the agents and the UI only ever see the interface. Switching an
adapter is an environment variable plus the vendor-side configuration below;
no engine code changes. Vendor facts in this document were verified against the
vendors' own documentation on 2026-10-29 (see `docs/vendor-api-notes.md` for
the raw notes and URLs).

| Dependency | Interface | Mock (default) | Real adapter | Switch |
|---|---|---|---|---|
| CRM history + outcomes | `CrmProvider` | synthetic book of business | `HttpCrmProvider` (thin export endpoint) | `CRM_PROVIDER=http` |
| Clay discovery/enrichment | `DiscoveryProvider`, `SignalCollector` | synthetic company facts | `ClayDiscoveryProvider` + webhooks | `DISCOVERY_PROVIDER=clay` |
| Own collectors (replace Clay) | `SignalCollector` | n/a | `NativeSignalCollector` (Claude + web search) | `SIGNAL_SOURCE_<TYPE>=native` |
| Jerry | agent (`lib/agents/jerry.ts`) | local Claude agent + `knowledge/jerry` | remote Jerry over MCP | `JERRY_MODE=mcp` |
| Contact enrichment data | `EnrichmentProvider` | deterministic mock | `ClayEnrichmentProvider` / `HttpEnrichmentProvider` | `ENRICHMENT_PROVIDER=clay\|http` |
| Tavus video | `VideoProvider` | scripted caption player | `TavusVideoProvider` + callback | `VIDEO_PROVIDER=tavus` |
| Cartage Sequencer | `OutreachProvider` | logs the sequence | `CartageSequencerProvider` | `OUTREACH_PROVIDER=sequencer` |
| Cartage Dialer | `DialerProvider` | local call queue | `CartageDialerProvider` | `DIALER_PROVIDER=cartage` |
| PostHog | `AnalyticsProvider` | first-party events only | `PostHogAnalyticsProvider` (mirror) | `ANALYTICS_PROVIDER=posthog` |
| Slack | `AlertProvider` | console | `SlackAlertProvider` (webhook or bot) | `ALERT_PROVIDER=slack` |
| RB2B | webhook route | n/a | `/api/webhooks/rb2b` | set `RB2B_WEBHOOK_SECRET` |
| Calendly | embed + webhook route | built-in booking form | inline embed + `/api/webhooks/calendly` | set `NEXT_PUBLIC_CALENDLY_URL` |
| Database | `Store` | JSON files in `.data/` | `SupabaseStore` | `STORE_PROVIDER=supabase` |
| Claude | `lib/llm.ts` | template text | Claude Opus 5.5 structured outputs | set `ANTHROPIC_API_KEY` |

Rough effort to wire each real system, assuming credentials are in hand:

| Integration | Effort | Notes |
|---|---|---|
| Supabase | 1 hour | run `supabase/migrations/0001_init.sql`, set two env vars |
| Claude | 10 minutes | set the key; prompts already in place |
| Slack | 30 minutes | create an incoming webhook |
| PostHog | 30 minutes | project token; optional `posthog-js` on the page |
| Calendly | 1 hour | scheduling link + webhook subscription |
| Tavus | half a day | train the face once, then API key + callback token |
| Clay | 1 day | build the two tables and the HTTP API column body below |
| RB2B | 1 hour | paste the webhook URL |
| CRM export | 1 day | depends on the CRM; the contract is small |
| Sequencer / Dialer | 1 day each | internal APIs; contracts proposed below |
| Jerry over MCP | 1 day | two tools on Jerry's side |

---

## Supabase

1. Create a project, run `supabase/migrations/0001_init.sql` (SQL editor or `supabase db push`).
2. Set `STORE_PROVIDER=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, and the server-only `SUPABASE_SECRET_KEY` (secret key `sb_secret_...` or the legacy service-role key).
3. Row Level Security is enabled on every table with no policies, so only the server key can read or write. The landing page and dashboard never talk to Supabase from the browser.

## Claude

Set `ANTHROPIC_API_KEY`. Model and effort are `LLM_MODEL` / `LLM_EFFORT`. Only the top `LLM_EXPLAIN_TOP_N` accounts per scoring run get Claude-written explanations; the rest use templates to keep cost flat. Every call uses structured outputs (zod schema), a cached system prompt, and server-side refusal fallbacks (`fallbacks: "default"`), and degrades to templates on any error so the 24/7 loop never stops.

## Clay

Clay is push-based both ways.

**Discovery table (companies).**

1. Create a table with a *Monitor webhook* source. Copy the webhook URL into `CLAY_DISCOVERY_WEBHOOK_URL` and the one-time token into `CLAY_WEBHOOK_TOKEN` (sent as `x-clay-webhook-token`). The engine POSTs `{ company_name, domain, industry, employee_count, hq_city, hq_state, requested_at, callback_url }` per company.
2. Add Clay's enrichment columns (job postings, news, technographics, people, headcount).
3. Add an **HTTP API** enrichment column that POSTs the finished row back to the engine:
   - Method `POST`, endpoint `https://<app>/api/webhooks/clay` (or `/api/create-page`, which also returns the page URL for the cell).
   - Header `x-webhook-secret: <CLAY_WEBHOOK_SECRET>`.
   - Body (Clay's `/Column Name` syntax; strings quoted, numbers unquoted):

   ```json
   {
     "company_name": "/Company Name",
     "domain": "/Domain",
     "industry": "/Industry",
     "employee_count": /Employee Count,
     "hq_city": "/HQ City",
     "hq_state": "/HQ State",
     "description": "/Description",
     "job_postings": "/Job Postings JSON",
     "news": "/News JSON",
     "tech_stack": "/Technologies JSON",
     "pain_evidence": "/Pain Evidence JSON",
     "people": "/Decision Makers JSON",
     "estimated_shipments_per_month": /Shipments Per Month,
     "clay_record_id": "/Record ID"
   }
   ```

   JSON-typed columns may be passed as JSON strings or arrays; see `ClayRow` in `lib/providers/discovery/clay.ts` for the exact field shapes. Set "Field paths to return" to `page_url` so the cell shows the personalized page link.

**Enrichment table (contacts).** Same pattern: a webhook source (`CLAY_ENRICHMENT_WEBHOOK_URL`) receiving `{ kind: "contact", account_slug, full_name, title, email, linkedin, company_name, domain, callback_url }`, the phone/LinkedIn/email waterfall columns, and an HTTP API column posting `{ "kind": "contact", "account_slug": "/Account Slug", "full_name": "/Full Name", "title": "/Title", "email": "/Email", "phone": "/Phone", "phone_verified": /Phone Verified, "linkedin": "/LinkedIn" }` back to `/api/webhooks/clay`.

**Clay MCP.** Clay's hosted MCP server (`https://api.clay.com/v3/mcp`, OAuth 2.0 PKCE) can be given to the agents as an additional tool source when more ad-hoc searching is wanted; it is not required for the flow above.

Docs: Clay HTTP API integration overview, webhook integration guide, connect-to-clay-mcp (links in `docs/vendor-api-notes.md`).

## Replacing Clay over time

Each signal type routes to a collector independently (`SIGNAL_SOURCE_HIRING`, `SIGNAL_SOURCE_EXPANSION`, `SIGNAL_SOURCE_TECHNOLOGY`, `SIGNAL_SOURCE_PAIN`). The `native` collector uses Claude with the web search server tool to find job postings, news, technographics and pain evidence with source URLs, then the same signal agents interpret them. Suggested path:

1. Run Clay and native side by side on one signal type (e.g. hiring) for a few weeks; compare precision against Research Agent verdicts and downstream conversion.
2. Flip that type to native once it matches; keep Clay for the rest.
3. Repeat per type. Clay's enrichment waterfall for contact data is usually the last to go.

## Jerry

Jerry is an agent, not an API. Two modes:

- `JERRY_MODE=local` (default): the agent in `lib/agents/jerry.ts` with the system prompt assembled from `knowledge/jerry/*.md`. Replace the placeholder files with the real training material; the folder is read fresh every minute.
- `JERRY_MODE=mcp`: the real Jerry exposed over MCP. Set `JERRY_MCP_URL` (Streamable HTTP) or `JERRY_MCP_COMMAND` (stdio). The engine calls two tools:
  - `enrich_contact { name, title, email?, linkedin?, company, domain }` returning `{ phone?, phone_verified?, linkedin?, email?, recent_news?, tech_stack?, notes? }`
  - `talk_track { company, contact, signals, engagement, pain_hypothesis?, angle? }` returning `{ talk_track, action, notes? }`

  Rename in `lib/agents/jerry-mcp.ts` if Jerry's tools are called something else. Everything else Jerry does (reading engagement, sending the alert, queuing the call) stays in the engine.

In both modes Jerry's data lookups go through the `EnrichmentProvider` (Clay or an in-house service).

## Tavus

1. Train a face once (`POST /v2/faces` with `model_name: "phoenix-4.5"` and a training video); put the resulting id in `TAVUS_REPLICA_ID`.
2. Set `VIDEO_PROVIDER=tavus`, `TAVUS_API_KEY`, and `TAVUS_WEBHOOK_SECRET` (callbacks are unsigned, so the token rides in the callback URL: `/api/webhooks/tavus?token=...`).
3. The Campaign Agent calls `POST https://tavusapi.com/v2/videos` with `replica_id`, `script`, `video_name`, `callback_url`; the callback updates `campaign.videoStatus`, `videoUrl`, `videoThumbnailUrl`. The page plays `stream_url`/`hosted_url` and fires the same 25/50/75/100 events as the mock player.
4. Tavus exposes no watch analytics for generated videos; engagement comes from our own player events, which is why the page hosts the video rather than linking out.

## Cartage Sequencer and Dialer (internal)

Proposed contracts, in `lib/providers/outreach.ts`:

- `POST {SEQUENCER_API_URL}/sequences` with the account, contact, touches `[{step, channel, subject?, body, scheduled_for}]` and experiment arms; returns `{ sequence_id, touches: [{step, external_id, status}] }`.
- `POST {SEQUENCER_API_URL}/sequences/{id}/adapt { reason }` when engagement changes what the next touch should say.
- The Sequencer should relay email/InMail events to `POST /api/track` as `email_open`, `email_click`, `email_reply`, `linkedin_accept`, `linkedin_reply` with `{ slug, event, properties: { step } }`.
- `POST {DIALER_API_URL}/queue { account_slug, contact, context, priority }` returns `{ call_id }`; call outcomes come back through `POST /api/outcomes`.

## CRM

`CRM_PROVIDER=http` with `CRM_EXPORT_URL` returning an array of historical prospects (`HistoricalRecord` shape, camelCase or snake_case) and accepting `POST {CRM_EXPORT_URL}/outcomes`. The important fields are `signalKeys` (which buying signals existed before first touch), `persona`, `outcome` (`won | lost | meeting | no_response`) and `messagingAngle`. If the CRM does not store signals, backfill them once from Clay/native collectors using each account's first-touch date.

## PostHog

`ANALYTICS_PROVIDER=posthog`, `POSTHOG_API_KEY` (project token), `POSTHOG_HOST` (`https://us.i.posthog.com` or EU). Every first-party engagement event is mirrored server-side via `POST {host}/i/v0/e/` with `distinct_id` = visitor id, so funnels and retention line up with the scoring loop. Add `posthog-js` to the page for session replay if wanted.

## Slack

`ALERT_PROVIDER=slack` with `SLACK_WEBHOOK_URL` (incoming webhook) or `SLACK_BOT_TOKEN` + `SLACK_CHANNEL` (chat.postMessage, scope `chat:write`). Alerts use Block Kit (header, fields, sections, buttons to the account brief and the page) within documented limits, with the plain-text version as fallback `text`.

## RB2B

Paste `https://<app>/api/webhooks/rb2b?token=<RB2B_WEBHOOK_SECRET>` into RB2B's webhook integration. Identified visitors from known accounts become `visitor_identified` events (which count toward activation); unknown companies become new `discovered` accounts for the team to research.

## Calendly

Set `NEXT_PUBLIC_CALENDLY_URL` to the scheduling link; the page embeds it inline with the contact's name and email prefilled and `utm_campaign` set to the account slug. Create a webhook subscription (`POST https://api.calendly.com/webhook_subscriptions`, events `invitee.created`, `invitee.canceled`, scope `organization`, `signing_key` = `CALENDLY_WEBHOOK_SIGNING_KEY`) pointing at `/api/webhooks/calendly`; bookings become `meeting_booked` outcomes and feed the learning loop.

## Running the team 24/7

- Long-running: `npm run worker` (Railway, Fly, ECS, a VM). Ticks every `AGENT_TICK_SECONDS`.
- Serverless: schedule `POST /api/agents/tick` every minute with `Authorization: Bearer <CRON_SECRET>`. On Vercel add to `vercel.json`:

  ```json
  { "crons": [{ "path": "/api/agents/tick", "schedule": "* * * * *" }] }
  ```

Several workers can share one Supabase database; agent state and the run log live there.
