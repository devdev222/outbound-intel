# Outbound Intelligence Engine

A working implementation of the "AI Outbound Intelligence Engine" MVP: a team of
ten agents that learns from historical conversions, discovers and scores
accounts, launches personalized campaigns, tracks engagement, activates reps
through Jerry, and retrains itself from every outcome.

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

Ten agents run continuously on cadences (`lib/agents/`). Each pulls its own work from the store, processes a bounded batch and writes back, so the team survives restarts and can run across several workers.

| Agent | Step | Does |
|---|---|---|
| ICP Agent | 2 | Matches companies to the learned profile, picks the persona, parks clear non-fits |
| Hiring Agent | 2 | Job postings into hiring signals with evidence links |
| Expansion Agent | 2 | Facilities, new markets, acquisitions, funding, leadership changes |
| Technology Agent | 2 | TMS / ERP / spreadsheet footprint; inferred states are hypotheses |
| Pain-Point Agent | 2 | Public evidence of coordination load, carrier and service problems, cost pressure; infers pain from hiring volume |
| Research Agent | 2 | Validates or rejects each signal against its evidence, picks the decision-maker, writes the brief, lists what is missing |
| Scoring Agent | 3 | Scores with the current model version, explains, qualifies |
| Campaign Agent | 4-5 | Builds and launches the personalized experience; polls video rendering |
| Jerry | 7 | Cartage's trained sales agent: enrichment, talk track, alert, call queue |
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

Without `ANTHROPIC_API_KEY` every agent uses a deterministic template path, so the demo is complete either way; with the key, explanations, briefs, playbooks, copy and talk tracks are written by Claude (Opus 5.5 by default, structured outputs, cached prompts, server-side refusal fallbacks).

## Running 24/7

- `npm run worker` as a long-running process (Railway, Fly, ECS), sharing the database with the web app.
- Or schedule `POST /api/agents/tick` every minute (Vercel Cron, GitHub Actions, pg_cron) with `CRON_SECRET`.
- Or, for a demo, press **Start loop** on the dashboard: the team ticks inside the dev server.

The Agents page shows each agent's cadence, last run, totals, the run log, and lets you pause or run any agent.

## Data and storage

- `STORE_PROVIDER=file` (default) keeps JSON under `.data/`; zero setup.
- `STORE_PROVIDER=supabase` uses the schema in `supabase/migrations/0001_init.sql` through the server-only secret key; RLS is on with no policies, so the browser never reaches the database.

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
