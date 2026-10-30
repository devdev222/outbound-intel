# Integration matrix

What each integration needs before it is real. "Verified" in this table means the actual contract was exercised against the real service; **nothing in this repository has been verified against a real external service yet**. All behavior below was tested only against mocks and controllable test adapters.

Kinds: **vendor** = third-party API implemented from the vendor's public docs. **bridge** = a contract this repo proposes for a Cartage-side service; Cartage must implement or confirm it. **builtin** = handled inside this app. Selection, required settings and supported actions come from `lib/capabilities.ts`.

| Capability | Integration | Kind | Needs credentials | Needs vendor/Cartage configuration | Needs more implementation | Status |
|---|---|---|---|---|---|---|
| Sign-in | OIDC (Okta, Entra ID, Google Workspace, Auth0) | vendor | `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | App registration with redirect `…/api/auth/oidc/callback`; users provisioned with `npm run user:add` | Group/role claim mapping (roles come from the app's user records today) | Code + unit tests (ID-token verification). Not verified against a real IdP |
| Storage | Supabase Postgres | vendor | `SUPABASE_SECRET_KEY` | Apply migrations 0001–0006 | None | Store contract test exists (opt-in `SUPABASE_TEST_URL`); not run against a project |
| Import accounts | Clay discovery table | vendor | `CLAY_WEBHOOK_SECRET` | Clay table + HTTP API column posting to `/api/webhooks/clay` | Clay delivery ids for dedupe (body hash used today) | Not verified |
| Import accounts | RB2B visitor identification | vendor | `RB2B_WEBHOOK_SECRET` | Webhook URL with token in RB2B | Event-id dedupe (body hash today) | Not verified |
| Verify contacts | Clay enrichment table | vendor | `CLAY_ENRICHMENT_WEBHOOK_URL`, `CLAY_WEBHOOK_SECRET` | Enrichment table with phone waterfall; callback mapping | Field-level verification flags from Clay's waterfall (only `phone_verified` today) | Not verified |
| Verify contacts | Jerry over MCP (`enrich_contact`) | bridge | `JERRY_MCP_TOKEN` (HTTP) | Jerry must expose the tools (names configurable) | Confirm tool schemas with Cartage | Proposed contract; tested against a fake MCP server only |
| Verify contacts | In-house enrichment API | bridge | `ENRICHMENT_API_KEY` | Service implementing the proposed contract | Contract confirmation | Proposed contract |
| Prepare content | Anthropic (Claude) | vendor | `ANTHROPIC_API_KEY` | None | None | Not verified in this environment (templates used without a key) |
| Prepare content | Tavus video | vendor | `TAVUS_API_KEY`, `TAVUS_WEBHOOK_SECRET` | Replica (`TAVUS_REPLICA_ID`), callback URL | None | Not verified |
| Deliver outreach | Resend email | vendor | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Verified sending domain; webhook for delivered/opened/clicked/bounced | None | Not verified; signed-webhook handling and dedupe tested locally |
| Deliver outreach | Cartage Sequencer | bridge | `SEQUENCER_API_KEY` | Sequencer implementing launch/pause/resume/adapt; one launch per buying-group person (`launch:<accountId>:c:<contactId>`), `contact_id` on every touch | Contract confirmation; reply events via `POST /api/events` with `contactId` or the person's email | Proposed contract |
| Deliver outreach | Cartage Dialer | bridge | `DIALER_API_KEY` | Dialer implementing `POST /queue` | Contract confirmation; call outcomes back via the API | Proposed contract |
| Deliver outreach | Slack rep alerts | vendor | `SLACK_WEBHOOK_URL` or `SLACK_BOT_TOKEN` | Channel / app | None | Not verified |
| Sync outcomes | CRM bridge (HubSpot/Salesforce behind HTTP) | bridge | `CRM_API_KEY` | Service implementing export + `POST /outcomes` with Idempotency-Key, `outcome_id`, `opportunity_id`, `contact_id` (+ the person's name/title/email) | Native HubSpot/Salesforce adapters if no bridge is built | Proposed contract; durable sync tested with a test adapter |
| Sync outcomes | Calendly | vendor | `CALENDLY_WEBHOOK_SIGNING_KEY` | Webhook subscription for invitee.created/canceled | None | Not verified |
| Sync outcomes | PostHog | vendor | `POSTHOG_API_KEY` | Project | None | Not verified |
| Machine API | `/api/v1/*`, `/api/events` | builtin | `MACHINE_IDENTITIES` (token hashes + scopes) | Issue tokens to each bridge | Token rotation tooling | Tested locally (scopes, idempotency, validation) |
| MCP server | stdio | builtin | n/a (`MCP_SCOPES`) | Client registration | Remote HTTP transport + OAuth (see docs/MCP.md) | Tested locally with a real MCP client over stdio |

To move a row to verified: configure it in a non-production environment, run its connection test on the Integrations page (tests with side effects ask for confirmation), and complete one real end-to-end call. The Integrations page then shows **Verified** for that provider and settings fingerprint.
