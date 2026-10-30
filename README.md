# Cartage Revenue Operating System

An AI-native outbound platform: a team of eleven agents learns from historical
conversions, discovers and scores accounts, verifies they are rep-ready,
launches personalized campaigns, tracks engagement, activates reps through
Jerry, captures what happens in every conversation, and retrains itself from
every outcome. The system does the preparation; the BDR does the selling.

## Workspaces and roles

Sign in at `/login`. The demo identity provider ships three users (password
`demo`, or `DEMO_PASSWORD`); swap `lib/auth/users.ts` for SSO and the roles and
route gating stay.

| Role | Home | What they see |
|---|---|---|
| Executive (`exec@cartage.demo`) | `/exec` | Command center: qualified pipeline, meetings booked/held, opportunities, pipeline per BDR, cost per opportunity, top signals, experiment results, capacity, AI recommendations, and "ask about performance" in plain language. Also `/pipeline`, `/intelligence`, `/lab`, `/capacity`, `/gifting`. |
| BDR (`bdr@cartage.demo`) | `/work` | Today's prepared queue: high-intent engagement, calls ready, follow-ups, meetings, exceptions. Each card has the verified contact, why now, the opener, the pain hypothesis, matched proof and the next action; "Start conversation" logs the outcome and the engine writes the summary, objections, follow-up draft and CRM update. |
| Admin (`admin@cartage.demo`) | `/console` | Revenue engineering: grouped agents, integrations, data sources, scoring model and economics settings, automation permissions, suppressions, reps, logs and errors, audit log. |

Accounts enter the BDR queue only after the readiness engine passes every
check (ICP fit, decision-maker, usable contact, fresh evidence with sources,
outreach hypothesis, CRM ownership, suppression); otherwise they go back to
enrichment with explicit blockers. Prospects see the shortened personalized
page at `/for/{slug}-{token}` and the Freight Operations Efficiency Assessment at
`/assess/{slug}-{token}`; both label every figure as an estimate.

It runs end to end on this machine with no accounts and no keys. Every external
system (Clay, Jerry, Tavus, Sequencer, Dialer, PostHog, Slack, RB2B, Calendly,
the CRM, Supabase, Claude) sits behind an adapter selected by an environment
variable, so wiring the real systems in is configuration, not a rewrite. See
[docs/WIRING.md](docs/WIRING.md).

## The loop

| Step | What happens | Where |
|---|---|---|
| 1. Learn | Historical prospects (won, lost, meeting, no response) are analyzed: conversion lift per buying signal, ICP buckets, category weights, messaging playbook | `lib/engine/learn.ts`, Learning Agent |
| 2. Discover | Companies arrive from Clay (webhook) or the synthetic generator; signal agents turn evidence into canonical signals with verified/hypothesis status | `lib/providers/discovery/*`, `lib/agents/signal-agents.ts` |
| 3. Score | Deterministic 0-100 score with learned weights; Claude writes the explanation, pain hypothesis and angle; verified vs hypothesis vs missing info are separated | `lib/engine/scoring.ts`, `lib/agents/scoring-agent.ts` |
| 4. Personalize | `/for/[company]` page, video script (Tavus), ROI defaults, case study, 5-touch sequence, A/B arms | `lib/engine/campaign.ts`, Campaign Agent, `app/(public)/for/[slug]` |
| 5. Experiment | Every account is assigned content format, video type, personalization depth, angle variant and gifting arm deterministically | `assignArms()` in `lib/engine/campaign.ts` |
| 6. Monitor | Page, video, calculator, case study, return visits, email/LinkedIn events raise engagement and priority; thresholds flag the account | `lib/engine/engagement.ts`, `POST /api/track` |
| 7. Activate | Jerry enriches the contact in real time, writes the talk track in the company's voice, posts the Hot Lead Alert to Slack, queues the call | `lib/agents/jerry.ts` |
| 8. Learn again | Meetings, wins and losses become training records; the model retrains, versions, and every account is re-scored | `lib/engine/outcomes.ts`, Learning Agent |

## The team

Eleven agents run continuously on cadences (`lib/agents/`). Each pulls its own work from the store, processes a bounded batch and writes back, so the team survives restarts and can run across several workers. Every action an agent takes on an account is written to that account's activity log and shown next to the prospect's own engagement on the account page.

| Agent | Step | Does |
|---|---|---|
| ICP Agent | 2 | Matches companies to the learned profile, picks the persona, parks clear non-fits |
| Hiring Agent | 2 | Job postings into hiring signals with evidence links |
| Expansion Agent | 2 | Facilities, new markets, acquisitions, funding, leadership changes |
| Technology Agent | 2 | TMS / ERP / spreadsheet footprint; inferred states are hypotheses |
| Pain-Point Agent | 2 | Public evidence of coordination load, carrier and service problems, cost pressure; infers pain from hiring volume |
| Research Agent | 2 | Validates or rejects each signal against its evidence, picks the decision-maker, writes the brief, lists what is missing |
| Scoring Agent | 3 | Scores with the current model version, explains, qualifies |
| Campaign Agent | 4-5 | Builds and launches the personalized page content and the 5-touch sequence; sends due touches or hands them to reps as tasks |
| Video Agent | 4 | Writes the 15-25s beat sheet and script from the whole dossier; submits AI renders to Tavus or issues a rep recording brief; rewrites when signals change |
| Jerry | 7 | Cartage's trained sales agent: enrichment, talk track, alert, call queue, adapts the next touch |
| Learning Agent | 8 | Retrains when new outcomes exist; bumps the model version |

## Quick start

```bash
npm install
cp .env.example .env.local      # optional: add ANTHROPIC_API_KEY for Claude-written content
npm run demo                    # the whole loop in the terminal, ~1 minute
npm run dev                     # dashboard at http://localhost:3000
```

In the dashboard: **Seed demo data**, then open any account, run the **hot-lead scenario**, watch the alert and the call queue appear, log **Meeting booked**, and open **Intelligence** to see the model version increment and the weights move. The personalized page for any account is linked from its brief (`/for/<slug>`); interacting with it feeds the same pipeline.

Other scripts: `npm run seed [count]`, `npm run learn`, `npm run score`, `npm run reset`, `npm run worker` (24/7 loop), `npm run mcp` (MCP server).

Verification: `npm test` (isolated test suite), `npm run smoke` (HTTP checks against a production build in a separate, credential-free process), `npm run check` (configuration and schema readiness for the current environment), `npm run verify` (typecheck, tests, build, smoke). See **Testing and release checks** below.

Without `ANTHROPIC_API_KEY` every agent uses a deterministic template path, so the demo is complete either way; with the key, explanations, briefs, playbooks, copy and talk tracks are written by Claude (Opus 5.5 by default, structured outputs, cached prompts, server-side refusal fallbacks).

## Outreach, rep tasks and the video

- **One task lifecycle.** Every touch is a task: `awaiting_approval` → `scheduled` → `sending` → `sent`, or `manual` (a person does it), `skipped`, `failed`. The buttons say what they do: **Review & approve** schedules and never sends; **Send email** asks the provider and the task is sent only when the provider acknowledges; **Mark manually sent** records work done outside the platform. Commitments a person made (callbacks, meeting prep, prospect requests) are separate from agent recommendations and keep their due dates through rescoring.
- **Email** goes through the active provider: mock (nothing leaves), Resend (real delivery with idempotency keys; opens and clicks flow back through `/api/webhooks/resend`), or Cartage Sequencer (owns the cadence). Every external call runs as a durable operation with a stable idempotency key, an atomic claim (two workers never both send) and bounded retries.
- **LinkedIn, InMail and gifts** have no sending API, so when the Sequencer is not active they become **manual tasks** with the drafted message and a deep link.
- **Pauses.** "Not now" on a call, or **Pause outreach** on the account page, sets `pausedUntil`. While paused the scheduler holds every task, the dialer is not called, and a Sequencer that owns scheduling is told to pause (retried until it confirms).
- **Prospect requests** from the personalized page go to validated endpoints that need the page token: "Send me times" records `meeting_requested` with a scheduling task (a booking is `meeting_booked` only once confirmed), and "Send me my estimate" creates an approval task. The page shows success only after the server acknowledges and retries transient failures with the same request id.
- **Video**: the Video Agent writes hook / proof / ask beats and the script from every other agent's output. The AI arm renders through Tavus (mock player until a key exists); the rep arm issues a recording brief and the rep attaches the clip on the account page. The video is embedded on the account page and on the prospect page at `#video`.
- **Integrations page** (`/console/integrations`): organised by capability (Import accounts → Verify contacts → Prepare content → Deliver outreach → Sync outcomes). Each connection names the active provider and transport and shows Mock, Not configured, Configured, Verified or Degraded, with last success, last error and the next action. Credentials alone are only Configured; a passing test or a real successful call against that provider makes it Verified, and a later failure makes it Degraded. Tests with real side effects (a Slack post, a real email, a Clay row) ask for confirmation.

## Playbook, sequences, templates and the Lab

- **Playbook** (`/playbook`): your positioning, tone rules, things never to say, an opening angle per buying signal, personas and objection handling. It feeds every Claude prompt that writes copy, Jerry's talk tracks and conversation follow-ups, and reps see the objection handling on Today. Precedence: your playbook, then the learned playbook, then the signal catalog.
- **Campaign defaults** (same page): what every campaign launches with (page or direct booking link, proof mode, video type, assessment invite, gift step, an optional fixed angle). Nothing is randomized outside an experiment.
- **Templates** (`/playbook/templates`): email, LinkedIn, InMail and call templates with `{{variables}}` (first_name, company, signal, angle, proof, page_url, booking_url, assessment_url and more). Upload .txt, .md, .html, .eml, .csv or .json; uploads arrive as drafts and only approved templates reach prospects in live mode. A line whose variables are all empty is left out.
- **Sequences** (`/playbook/sequences`): your cadences, step by step (day, channel, one of your templates or "engine writes it"), with an optional segment rule and priority. An account gets a Lab sequence arm first, then the best matching active sequence, then the default, then the built-in 5-touch sequence. Every sequence has a no-side-effect preview for a real account.
- **Experimentation Lab** (`/lab`): each experiment answers one question by changing one setting (sequence, one step's template, angle, proof, page vs direct link, video, assessment invite, gift) against today's setting as the control. Two running experiments can't change the same setting. Accounts enroll as their campaigns launch; results say "collecting" until each arm reaches its sample size; "Roll out" makes the winner the default.

## Production readiness: identity, integrity, contracts

- **Sign-in.** Live mode refuses demo passwords. Set `AUTH_PROVIDER=oidc` with `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and provision users with `npm run user:add -- <email> <role> [repId]`. Without that, nobody can sign in (fails closed) and `npm run check` says why.
- **Telemetry vs provider events.** `/api/track` is public page telemetry only: it needs the page token, accepts page events only, ignores repeats and is score-capped per day. Page events never activate a rep on their own; an authenticated touch (signed webhook, `POST /api/events` with a machine token) must corroborate them.
- **Wrong contact.** Removes the contact and its verification, holds contact-specific outreach, sends the account back to research (the person is never re-selected) and rebuilds the sequence for the next verified contact. History is kept.
- **Idempotency.** Webhook deliveries, conversation submissions, outcome writes, `/api/v1` and MCP mutations are recorded once per key in the `operations` table.
- **CRM write-back.** Durable: one operation per outcome (`crm:<outcome id>`, also the Idempotency-Key), retried with backoff by the Learning Agent, failures visible on the account and the Integrations page.
- **Concurrency.** Account updates are atomic patches (compare-and-swap on Supabase), so engagement, assignments, pauses and outcomes never overwrite each other. Late outcomes never downgrade training history. Phone verification is bound to the verified number.
- **Contracts.** `lib/contracts/operations.ts` defines each operation once (validated input/output, scope, errors, pagination, retry). The same definitions back `POST /api/v1/<name>`, the MCP server and `docs/CONTRACTS.md` (`npm run contracts:doc`).
- **Capabilities.** `lib/capabilities.ts` is the single registry for provider selection, required settings, supported actions and kind (mock, test, built in, proposed bridge, vendor API). See `docs/INTEGRATIONS.md` for what each integration still needs and `docs/MCP.md` for MCP scopes and remote-access requirements.

## Running 24/7

- `npm run worker` as a long-running process (Railway, Fly, ECS), sharing the database with the web app.
- Or schedule `POST /api/agents/tick` every minute (Vercel Cron, GitHub Actions, pg_cron) with `CRON_SECRET`.
- Or, for a demo, press **Start loop** on the dashboard: the team ticks inside the dev server.

The Agents page shows each agent's cadence, last run, totals, the run log, and lets you pause or run any agent.

## Data and storage

- `STORE_PROVIDER=file` (default) keeps JSON under `.data/`; zero setup.
- `STORE_PROVIDER=memory` keeps everything in process memory. With `AUTO_SEED=true` each server instance seeds the deterministic synthetic dataset on boot, which is how the hosted demo runs. Data resets on cold starts and is not shared between instances, so treat it as a tour, not a system of record.
- `STORE_PROVIDER=supabase` uses the server-only secret key; RLS is on with no policies, so the browser never reaches the database. Apply **every** migration, in order:

  ```bash
  psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
  psql "$DATABASE_URL" -f supabase/migrations/0002_activity_and_rep_tasks.sql
  psql "$DATABASE_URL" -f supabase/migrations/0003_documents_and_platform.sql
  psql "$DATABASE_URL" -f supabase/migrations/0004_reliability.sql
  psql "$DATABASE_URL" -f supabase/migrations/0005_integrity.sql
  ```

  (or paste them in that order into the Supabase SQL editor). `0004` adds the account fields the app relies on (owner, readiness, next action, experiments, pipeline value, CRM owner, pause, enrichment state), task lifecycle columns, alert deliveries, opportunity ids, the `operations` table and `app_meta.schema_version`. `npm run check` and `GET /api/health` refuse to report ready until the schema version matches.

## Deploying

- **Hosted demo (ephemeral):** `vercel deploy --prod` from the repo root. On Vercel the defaults switch to the memory store with auto-seed, and the public URL is taken from Vercel's system environment, so no variables are required. Add `ANTHROPIC_API_KEY` in the project settings to get Claude-written content.
- **Real deployment:** set `APP_MODE=live`, `STORE_PROVIDER=supabase` with the Supabase URL and secret key (and all five migrations applied), `AUTH_SECRET` (32+ characters), `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, a real `ENRICHMENT_PROVIDER`, and every callback secret for the providers you enable (Clay, Tavus, Resend, Calendly). Run `npm run check` until it reports ready. Live mode turns off demo seed/reset and simulation, refuses unsigned callbacks, never treats mock enrichment as verified, cites only approved customer proof, and signs unsubscribe links per recipient. Run `npm run worker` on a long-running host (or a per-minute cron on `/api/agents/tick` with the `CRON_SECRET` bearer) so the team runs around the clock.

## Testing and release checks

- `npm test` runs the suite with `test/setup.ts` preloaded before any app module: in-memory store, controllable test adapters, every credential removed and a network guard that blocks non-local requests. Tests cover store round trips, approval vs delivery, pause through rescoring, duplicate workers, provider failures and bounded retries, per-destination alert/dialer delivery, prospect requests, opportunity counting, integration status, Jerry-over-MCP recovery, and the full journey (import → enrich → qualify → assign → approve → deliver → activate → conversation → pause → resume → meeting request → confirmed meeting → outcome sync), clean and with timeouts plus two racing workers.
- `npm run smoke` starts the production build in a separate process with a minimal environment (memory store, test adapters, credentials blanked) and checks the permission boundaries and public contracts over HTTP.
- `SUPABASE_TEST_URL=... SUPABASE_TEST_KEY=... npm test` adds the Supabase store contract test, and `npm run journey` runs the full journey on that test project. Use a dedicated test project: neither command resets data, but both write to it.

## How scoring and learning work

- **Signal patterns.** For every signal key, conversion rate with vs without the signal (Laplace-smoothed), lift, and a weight from log-lift scaled by sample size. A signal common among customers and non-converters alike gets lift ~1 and no weight; this is the "compare winners to non-converters" requirement.
- **ICP.** Conversion lift by industry, size band and persona.
- **Category weights.** The spec's priors (30/25/20/15/10) are blended toward the data-derived predictive power of each category (correlation of each sub-score with conversion), with the blend strength growing with sample size. Weights live in the model, not in a database column.
- **Score.** Deterministic and auditable: `Σ weight × sub-score`. Hypotheses count half; unvalidated signals count a little; intent signals from engagement count toward timing.
- **Priority.** Score plus an engagement bonus, capped at 100; this is the number reps see move.
- **Conversion** means closed-won or meeting booked, matching the MVP's own month-one metric.

## MCP server

`npm run mcp` exposes the engine over MCP (stdio) with tools `list_hot_leads`, `search_accounts`, `get_account_brief`, `record_engagement`, `log_outcome`, `get_model_summary`, `run_agent`. Register it in Claude Code with:

```bash
claude mcp add outbound-intel -- npm --prefix <path-to-repo> run -s mcp
```

Jerry (or any other agent) can drive the engine the same way.

## Webhooks and routes

| Route | Purpose |
|---|---|
| `POST /api/track` | First-party engagement events (page, video, calculator, email relays) |
| `POST /api/outcomes` | Sales outcomes; terminal ones feed the learning loop |
| `POST /api/create-page` | Spec endpoint for Clay: upsert a company, return its page URL |
| `POST /api/webhooks/clay` | Enriched company and contact rows from Clay |
| `POST /api/webhooks/tavus` | Video ready / error callback |
| `POST /api/webhooks/rb2b` | Identified website visitors |
| `POST /api/webhooks/calendly` | Booked / canceled meetings (signed) |
| `POST /api/agents/tick` | One runtime tick for schedulers |
| `GET /api/agents` | Team status for the dashboard |

## Decisions that differ from the spec document

- `total_score` is written by the scoring agent, not a generated column with constant weights; the learning loop changes weights per model version.
- Scoring accuracy in month one is measured by backtesting the model against historical outcomes (the Intelligence page shows in-sample category correlations); live accuracy follows as outcomes accrue.
- Reply rate is attributed to the Sequencer (the spec's metrics table mentions Instantly).
- Jerry is modeled as an agent with a knowledge base and an MCP option, not as an enrichment API; the enrichment data source is a separate provider Jerry calls.
- Clay is first-class today and replaceable one signal type at a time through the signal-source router.

## What is synthetic here

The historical book of business, the discovered companies, their job postings, news, tech stack, pain quotes and people, the case studies, Jerry's knowledge files and the contact enrichment results are all generated or placeholder content. They exist so the loop can be demonstrated and measured; each is replaced by a real adapter or real files as described in `docs/WIRING.md`.

## Layout

```
app/(public)/for/[slug]     personalized landing page (prospect-facing)
app/(dashboard)             pipeline, accounts, agents, intelligence, alerts
app/api                     tracking, outcomes, agents, webhooks
components/landing          tracker, video player, ROI calculator, case study, booking
components/dashboard        tables, score breakdown, simulator, team view
lib/agents                  the ten agents + runtime
lib/engine                  learn, scoring, campaign, engagement, outcomes, seed
lib/providers               adapter interfaces, mocks and real implementations
lib/store                   file store and Supabase store
lib/synthetic               deterministic data generator
knowledge/jerry             Jerry's knowledge base (replace with the real one)
mcp/server.ts               the engine as an MCP server
scripts/                    seed, learn, score, demo, worker, reset
supabase/migrations         Postgres schema
docs/                       wiring plan and verified vendor API notes
```
