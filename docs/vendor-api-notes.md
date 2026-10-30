# Vendor API notes (official docs only)

Researched 2026-10-29. Every fact below was read from the vendor's own documentation domain on that date; items that could not be confirmed are listed under "Not verified" in each section. Where a doc page did not quote JSON verbatim, the shape is reconstructed from the documented field list and marked as such.

---

## 1. Clay (clay.com)

**Docs read**
- https://university.clay.com/docs/http-api-integration-overview (HTTP API enrichment, outbound)
- https://university.clay.com/docs/webhook-integration-guide (Webhook source, inbound)
- https://university.clay.com/docs/clay-to-zapier (outbound example)
- https://university.clay.com/docs/connect-to-clay-mcp (MCP, OAuth integration path)
- https://university.clay.com/docs/mcp-troubleshooting-and-faqs (MCP end-user path)

**Outbound: "HTTP API" enrichment column (Clay -> your endpoint)**
- Add enrichment -> search `HTTP API` -> `Configure` tab (manual) or `Generate` (AI). `Test` runs one row.
- Method: `GET` | `POST` | `PUT` | `DELETE`. Endpoint: full URL. Query params: key/value pairs.
- Headers: arbitrary key/value (e.g. `Authorization: Bearer <token>`, `X-API-Key`). `Content-Type: application/json` is added automatically. Headers can be stored as a reusable "account" (`Select header account` -> `+ Add account`, managed in Settings -> Connections). Separate action `HTTP API with JWT Authentication` for dynamic JWTs.
- Body (POST/PUT) is JSON you author; column references use the `/Column Name` syntax. Strings and dynamic string refs must be quoted; numbers/booleans unquoted:
```json
{"email": "/Email Column", "score": /Score Column, "subscribed": true}
```
- One request per row; the cell stores the HTTP response (status 200 shown on success). `Field paths to return` filters the stored response (e.g. `data.user.email`). `Remove empty fields from request` toggle drops null/empty keys. Conditional-run formula gates the column.
- Rate limit control per column: `Request limit` + `Duration (ms)` (e.g. 10 per 1000 ms).
- Error codes surfaced in the cell: 200, 400 (`Body parse error` = bad JSON), 401, 402, 403, 404, 409, 429.
- No fixed outbound schema: the payload is whatever JSON you build. Design your receiver to accept a flat object keyed by your chosen names.

**Inbound: Webhook source (your system -> Clay table)**
- Workbook -> `+ Add` -> search `Webhooks` -> `Monitor webhook`. Clay generates a unique per-table URL and a cURL command. Can also be attached to an existing table via Actions -> Import (per docs search summary).
- Accepts HTTP `POST` with a JSON body; each POST becomes a row, JSON keys become/map to columns.
- Optional auth token: "include an authentication token in the header of your request" (token shown once; copy immediately).
- Limit: 50,000 submissions per webhook source, persists after deleting rows; Enterprise "Auto-delete (passthrough tables)" lifts it. Otherwise create a new webhook (new URL) when capped.
- Clay cannot reply to the inbound request with data (fire-and-forget).

**Official MCP server**
- Hosted only (no self-host): endpoint `https://api.clay.com/v3/mcp`. JSON-RPC over HTTP POST with `initialize` and an `Mcp-Session-Id` header returned by the server (i.e. Streamable HTTP semantics; the page does not name the transport).
- Auth: OAuth 2.0 authorization-code + PKCE (S256), Dynamic Client Registration (RFC 7591), scope `mcp`. Endpoints: authorize `https://app.clay.com/oauth/authorize`, token `https://api.clay.com/oauth/token`, register `https://api.clay.com/oauth/register`, revoke `https://api.clay.com/oauth/revoke`. Access token TTL 1 h; refresh tokens rotate. Unauthenticated POST returns 401 with `WWW-Authenticate` pointing at protected-resource metadata.
- End-user path: Claude official connector (claude.com/connectors/clay); Claude Code / Claude Desktop / Cursor / VS Code self-register via OAuth and show an "Unverified application" consent screen. Workspace admin must enable the `Unknown` toggle under Settings -> MCP users -> `Allowed MCP clients`. Viewer role cannot connect; Sales Rep is the minimum.
- Tools (as named in FAQ): find contacts / search companies, query Audiences (read-only), run Functions by name, "List subroutines", "Open in Clay"; ChatGPT action `run_subroutine_no_mapping`. Results paginate 20/page, max 100. Search is free; enrichments/Functions consume workspace credits at normal rates; admins can set per-user credit caps.

**Not verified**
- Exact inbound webhook URL pattern (domain/path) and the auth header name are not printed in the docs; copy from the UI.
- No documented inbound response body or inbound size limits. No documented outbound retry policy. No JSON config snippet for Claude Desktop/Code published by Clay.

---

## 2. Tavus (docs.tavus.io)

**Docs read**
- https://docs.tavus.io/api-reference/video-request/create-video
- https://docs.tavus.io/api-reference/video-request/get-video
- https://docs.tavus.io/sections/video/quickstart, https://docs.tavus.io/sections/video/overview.md
- https://docs.tavus.io/sections/webhooks-and-callbacks.md (callback payloads, verbatim)
- https://docs.tavus.io/api-reference/phoenix-replica-model/create-replica (now titled "Create Face"), https://docs.tavus.io/sections/replica/quickstart, https://docs.tavus.io/sections/faces/overview

**Auth**: header `x-api-key: <api key>`; `Content-Type: application/json`. Base URL `https://tavusapi.com`.

**Create video**: `POST https://tavusapi.com/v2/videos`
- Required: `replica_id` (string; the face ID, same value as `face_id` from `/v2/faces`) and exactly one of `script` (string) or `audio_url` (string, public .wav/.mp3).
- Optional: `video_name` (string), `callback_url` (string), `background_url` (string, website), `background_source_url` (string, video), `fast` (boolean; no thumbnails/stream URL in fast mode), `transparent_background` (boolean, needs `fast`), `watermark_image_url` (string), `properties` { `background_scroll` bool, `background_scroll_type` "human"|"smooth", `background_scroll_depth` "middle"|"bottom", `background_scroll_return` "return"|"halt", `start_with_wave` bool }.
- 200 response: `video_id`, `video_name`, `status` ("queued"|"generating"|"ready"|"deleted"|"error"), `hosted_url`, `created_at`. 400 -> `{ "error": string }`, 401 -> `{ "message": string }`.

**Get video**: `GET https://tavusapi.com/v2/videos/{video_id}?verbose=true`
- Response: `video_id`, `video_name`, `status`, `data.script`, `download_url`, `stream_url`, `hosted_url` (all three populated only when `status=="ready"`), `status_details`, `created_at`, `updated_at`; with `verbose=true` also `still_image_thumbnail_url` and `gif_thumbnail_url`.
- Also available: `GET /v2/videos` (list), `DELETE /v2/videos/{video_id}`, `PATCH .../name` (rename).

**Completion callback** (POST to `callback_url`; fires on completed and on error). Verbatim from docs:
```json
{
  "created_at": "2024-08-28 15:27:40.824457",
  "data": { "script": "Hello this is a test to give examples of callbacks" },
  "download_url": "https://stream.mux.com/.../high.mp4?download=1e30440cf9",
  "generation_progress": "100/100",
  "hosted_url": "https://videos.tavus.io/video/1e30440cf9",
  "face_id": "rc9cff32ceba",
  "status": "ready",
  "status_details": "Your request has processed successfully!",
  "stream_url": "https://stream.mux.com/....m3u8",
  "updated_at": "2024-08-28 15:29:19.802670",
  "video_id": "1e30440cf9",
  "video_name": "face_id: rc9cff32ceba - August 28, 2024 - video: 1e30440cf9"
}
```
Error variant: `status: "error"`, `download_url: null`, `stream_url: null`, `error_details: null`, `generation_progress: "0/100"`, `status_details` holds the message. Face-training callbacks are sent twice (one with `replica_id`, one with `face_id`, same value); key off `face_id`.

**Replica model (Phoenix)**: Faces are created with `POST https://tavusapi.com/v2/faces` body `model_name` in {`phoenix-4.5` (current default), `phoenix-4`, `phoenix-3` (legacy)} plus `train_video_url` or `train_image_url` (+ `voice_name` or `default_voice_id`), `face_name`, `callback_url`. Response `face_id`, `status` ("started"|"completed"|"error"). Docs have renamed "replica" to "face"; `/v2/replicas` and `replica_id` remain as legacy aliases.

**Not verified / absent**
- No view/engagement/watch-time analytics for generated videos anywhere in the docs index (llms.txt); analytics exist only for CVI conversations (perception events). Treat `hosted_url` as a plain share page.
- Callback HTTP method, retries and signatures are not documented. No rate limits or pricing on these pages.

---

## 3. PostHog (posthog.com/docs)

**Docs read**
- https://posthog.com/docs/api/capture (HTTP ingestion)
- https://posthog.com/docs/libraries/node, https://posthog.com/docs/references/posthog-node, and `packages/node/src/types.ts` in github.com/PostHog/posthog-js (EventMessage type)
- https://posthog.com/docs/libraries/js, https://posthog.com/docs/libraries/js/features, https://posthog.com/docs/references/posthog-js, https://posthog.com/docs/getting-started/install, https://posthog.com/docs/product-analytics/identify

**HTTP capture (server-side)**
- Hosts: US `https://us.i.posthog.com`, EU `https://eu.i.posthog.com` (or self-hosted). POST only, `Content-Type: application/json`. Auth = project token in body field `api_key` (no header).
- Single event: `POST {host}/i/v0/e/`
```json
{ "api_key": "<ph_project_token>", "event": "event name", "distinct_id": "user distinct id",
  "properties": { "key": "value", "$set": { "email": "x@y.z" }, "$set_once": { "first_seen": "..." } },
  "timestamp": "2026-10-29T12:00:00Z" }
```
  `distinct_id` max 200 chars (truncated). Anonymous: `properties.$process_person_profile = false`.
- Batch: `POST {host}/batch/`
```json
{ "api_key": "<ph_project_token>", "historical_migration": false,
  "batch": [ { "event": "...", "distinct_id": "...", "properties": {}, "timestamp": "ISO8601" } ] }
```
  No event-count limit; whole body < 20 MB. Response `200 OK` even for dropped events (missing event name or distinct_id). No rate limits stated.

**Node SDK**: package `posthog-node`
```ts
import { PostHog } from 'posthog-node'
const client = new PostHog('<ph_project_token>', { host: 'https://us.i.posthog.com' }) // host default https://us.i.posthog.com/; flushAt 20; flushInterval 5000
client.capture({ distinctId: 'id', event: 'user signed up', properties: { login_type: 'email', $set: { email: 'a@b.c' } } })
await client.shutdown() // or await client.flush() in serverless
```
`EventMessage = { distinctId?: string; event: string; properties?: Record<string|number, any>; groups?: Record<string, string|number>; flags?: FeatureFlagEvaluations; sendFeatureFlags?: boolean|SendFeatureFlagsOptions /*deprecated*/; timestamp?: Date; uuid?: string; disableGeoip?: boolean }`. `client.alias({ distinctId, alias })`. No server-side `identify`; set person props via `$set`/`$set_once` in `properties`.

**Web (posthog-js)**: package `posthog-js`; snippet from docs begins `<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(...` and ends with:
```js
posthog.init('<ph_project_token>', { api_host: 'https://us.i.posthog.com', defaults: '2026-08-30' })
```
(EU: `api_host: 'https://eu.i.posthog.com'`). npm: `import posthog from 'posthog-js'` then same `init`.
- `posthog.capture(event_name: string, properties?: Properties | null, options?: CaptureOptions)`
- `posthog.identify(new_distinct_id: string, userPropertiesToSet?: Properties, userPropertiesToSetOnce?: Properties)` -> second arg = `$set`, third = `$set_once`.
- `posthog.setPersonProperties(userPropertiesToSet?, userPropertiesToSetOnce?)`; `posthog.reset()` on logout; `posthog.group(type, id, props?)`.

**Not verified**: none material. (`/i/v0/e/` is the documented current path; legacy `/capture/` not re-checked.)

---

## 4. RB2B (rb2b.com)

**Docs read**
- https://support.rb2b.com/en/articles/8976614-setup-guide-webhook (payload, verbatim)
- https://support.rb2b.com/en/articles/9806566-webhook-faqs
- https://support.rb2b.com/en/articles/12880800-using-the-rb2b-oem-program-api-webhook-guide

**Configuring the destination**: app.rb2b.com -> Integrations -> Webhook (https://app.rb2b.com/integrations/webhook) -> paste HTTPS URL -> Save -> "Send a Test Event To Your [integration] Account". No custom headers or body: put a long random token in the URL path as the shared secret (RB2B explicitly has no HMAC signing). Toggles: "Sync company-only profiles", "Send repeat visitor data".

**Payload** (fixed; one request per identified page view). Verbatim sample:
```json
{
  "LinkedIn URL": "https://www.linkedin.com/in/retentionadam/",
  "First Name": "Adam",
  "Last Name": "Robinson",
  "Title": "CEO @ Retention.com. ...",
  "Company Name": "Retention.com",
  "Business Email": "adam@retention.com",
  "Website": "https://retention.com",
  "Industry": "Internet Technology & Services",
  "Employee Count": "1-10",
  "Estimate Revenue": "$22M rev",
  "City": "Austin",
  "State": "Texas",
  "Zipcode": "73301",
  "Seen At": "2024-01-01T12:34:56:00.00+00.00",
  "Referrer": "https://retention.com",
  "Captured URL": "https://rb2b.com/pricing",
  "Tags": "Hot Page, Hot Lead",
  "is_repeat_visit": true
}
```
Content format (from the guide): `LinkedIn URL` string(URL) never null; `First Name`, `Last Name`, `Title`, `Company Name`, `Business Email`, `Industry`, `Estimate Revenue`, `Tags` string|null; `Website`, `Referrer` string(URL)|null; `Employee Count` integer|string|null; `City`, `State`, `Zipcode` string never null; `Seen At` ISO 8601 datetime never null; `Captured URL` string(URL) never null; `is_repeat_visitor` boolean (only when repeat-visitor toggle on). Note the name mismatch: sample says `is_repeat_visit`, schema says `is_repeat_visitor`; accept both. Keys contain spaces and capitals; parse with bracket access. The sample `Seen At` value is not strictly valid ISO 8601; parse defensively. OEM payloads may add `customer_id`.

**Delivery**: return 2xx promptly; repeated failures/timeouts cause RB2B to auto-disable the webhook (manual re-enable in settings). Schema-mismatch advice: accept nulls for optional fields.

**API beyond webhooks**: only for OEM-program partners. Headers `Api-Key: <oem key>`, `Content-Type: application/json`, `Accept: application/json`, `User-Agent` (required). `POST https://app.rb2b.com/api/v1/add_domain` `{ "domain": "sub.domain.com" }` -> `{ "domain": "...", "added": true }`; `POST .../api/v1/delete_domain` -> `{ "domain_deleted": true }`; `GET .../api/v1/domains` -> `{ "domains": [...] }`; `GET .../api/v1/credit_usage` -> `{ "credits_used", "last_billing_date", "next_billing_date" }`. No visitor-lookup/read API exists for standard accounts.

**Not verified**: HTTP method (presumed POST) and Content-Type are not stated on any page; retry count/schedule not documented; the sample email is obfuscated by the help-center renderer.

---

## 5. Slack incoming webhooks and chat.postMessage (api.slack.com -> docs.slack.dev)

**Docs read** (api.slack.com URLs 302 to docs.slack.dev)
- https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks
- https://docs.slack.dev/reference/methods/chat.postMessage
- https://docs.slack.dev/reference/block-kit/blocks/header-block, .../section-block, .../actions-block, https://docs.slack.dev/reference/block-kit/block-elements/button-element

**Incoming webhook**: `POST https://hooks.slack.com/services/<team-id>/<channel-id>/<webhook-token>`, `Content-Type: application/json`. No auth header; the URL is the secret. Channel/username/icon are fixed by the app config.
```json
{ "text": "Fallback / notification text", "blocks": [ ... ] }
```
- Success: HTTP 200, body `ok`. Errors: 400/403/404 with plain-text codes `invalid_payload`, `no_text`, `channel_not_found`, `channel_is_archived`, `action_prohibited`, `invalid_token`, `no_active_hooks`, `no_service`, `no_team`, `team_disabled`, `too_many_attachments`, `user_not_found`, `posting_to_general_channel_denied`. Do not retry `action_prohibited`, `invalid_payload`, `channel_not_found`, `user_not_found` without changes. Max 100 attachments; max 50 blocks per message. Rate limits not stated on the page. Webhooks cannot update/delete messages.

**Block Kit for a rich alert** (limits from the block reference pages):
```json
{ "text": "New hot visitor: Acme Corp",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "New hot visitor" } },
    { "type": "section",
      "text": { "type": "mrkdwn", "text": "*Acme Corp* viewed <https://example.com/pricing|/pricing>" },
      "fields": [
        { "type": "mrkdwn", "text": "*Name*\nJane Doe" },
        { "type": "mrkdwn", "text": "*Title*\nVP Sales" } ] },
    { "type": "actions", "block_id": "visitor_actions",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "Open in CRM" },
          "url": "https://crm.example.com/leads/123", "action_id": "open_crm", "style": "primary" } ] } ] }
```
- header: `text` must be `plain_text`, max 150 chars. section: `text` 1-3000 chars, `fields` max 10 items x 2000 chars (two-column layout), optional `accessory`, `expand`. actions: `elements` max 25; `block_id` max 255. button: `text` plain_text max 75 (truncates ~30), `action_id` max 255, `url` max 3000, `value` max 2000, `style` `primary`|`danger`, optional `confirm`. URL buttons still send an interaction payload that must be acked (irrelevant for webhook-only apps without interactivity).

**chat.postMessage alternative**: `POST https://slack.com/api/chat.postMessage`, `Authorization: Bearer xoxb-...`, `Content-Type: application/json; charset=utf-8` (form-encoded also accepted). Scope `chat:write` (+ `chat:write.public` for channels the bot has not joined, `chat:write.customize` for `username`/`icon_url`).
- Body: `channel` (string, required: channel ID or user ID), `text` (string; fallback when `blocks` present), `blocks` (array), `attachments` (array), `thread_ts` (string), `reply_broadcast` (bool), `unfurl_links`/`unfurl_media` (bool), `mrkdwn` (bool, default true), `parse`, `link_names`, `metadata` { `event_type`, `event_payload` }, `markdown_text` (string, max 12k, exclusive with text/blocks).
- Response: `{ "ok": true, "channel": "C...", "ts": "1700000000.123456", "message": { ... } }`; on failure `{ "ok": false, "error": "channel_not_found" }`. Errors of note: `not_in_channel`, `channel_not_found`, `invalid_blocks`, `msg_blocks_too_long`, `missing_scope`, `invalid_auth`, `ratelimited` (honor `Retry-After`). Rate limit: special tier (roughly 1 message/sec per channel with bursts).

**Not verified**: incoming-webhook rate limits (not on page); exact per-workspace message cap.

---

## 6. Calendly (developer.calendly.com)

**Docs read** (append `.md` to any developer.calendly.com URL for markdown)
- https://developer.calendly.com/api-docs/overview/embedding/getting-started.md, .../embedding/recipes.md, .../embedding/notifying-the-parent-window.md
- https://calendly.com/help/how-to-pre-fill-invitee-information-in-your-calendly-link, https://calendly.com/help/how-to-pre-fill-invitee-information-in-an-embed, https://calendly.com/help/how-to-source-track-your-calendly-embed-with-utm-parameters
- https://developer.calendly.com/api-docs/calendly-api/webhooks/create-webhook-subscription.md, .../webhooks/get-sample-webhook-data.md, https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures.md, .../webhook-errors.md, .../webhook-timeouts.md

**Inline embed**
```html
<div class="calendly-inline-widget"
     data-url="https://calendly.com/YOUR_LINK/30min?hide_event_type_details=1&utm_source=rb2b&name=John%20Doe&email=john%40example.com"
     style="min-width:320px; height:630px;"></div>
<script type="text/javascript" src="https://assets.calendly.com/assets/external/widget.js" async></script>
```
- Advanced JS (needed for `prefill` object; `data-auto-load="false"` on the div):
```js
Calendly.initInlineWidget({
  url: 'https://calendly.com/YOUR_LINK/30min',
  parentElement: document.getElementById('calendly-embed'),
  prefill: { name: 'John Doe', email: 'john@doe2.com', firstName: 'John', lastName: 'Doe', customAnswers: { a1: 'Yes' } },
  utm: { utmCampaign: 'Spring Sale 2019', utmSource: 'Facebook', utmMedium: 'Ad', utmContent: 'Shoe and Shirts', utmTerm: 'Spring' }
});
```
- Scheduling-link query params (work in `data-url` too): `name`, `first_name`, `last_name`, `email`, `location`, `guests` (comma list), `a1..aN` custom answers; `hide_event_type_details=1`, `hide_landing_page_details=1`; UTM: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `salesforce_uuid` only (each < 255 chars, no custom params). `utm` object overrides URL UTMs.
- Parent-window `postMessage` events: `calendly.profile_page_viewed`, `calendly.event_type_viewed`, `calendly.date_and_time_selected`, `calendly.event_scheduled` (payload `{ event: { uri }, invitee: { uri } }`), `calendly.page_height` (`{ height: "1200px" }`).

**Webhook subscription**: `POST https://api.calendly.com/webhook_subscriptions`, `Authorization: Bearer <PAT or OAuth token>`, `Content-Type: application/json`, needs `webhooks:write` (+ `scheduled_events:read` for invitee events). Standard plan or higher.
```json
{ "url": "https://your.app/webhooks/calendly", "events": ["invitee.created", "invitee.canceled"],
  "organization": "https://api.calendly.com/organizations/<uuid>", "scope": "organization",
  "user": "https://api.calendly.com/users/<uuid>", "signing_key": "<random secret>" }
```
`scope` in {`organization`,`user`,`group`} (`user`/`group` URIs required for those scopes). Events: `invitee.created`, `invitee.canceled`, `invitee_no_show.created|deleted`, `event_type.created|updated|deleted`, `meeting_recap.created|updated|deleted` (user scope), `routing_form_submission.created` (org scope), `contact.created|updated|deleted`. 201 -> `{ "resource": { "uri", "callback_url", "created_at", "updated_at", "retry_started_at", "state": "active"|"disabled", "events", "scope", "organization", "user", "group", "creator" } }`. Sample payloads: `GET https://api.calendly.com/sample_webhook_data?event=invitee.created&organization=...&scope=organization`.

**invitee.created payload** (verbatim sample, trimmed):
```json
{ "event": "invitee.created", "created_at": "2020-11-23T17:51:19.000000Z",
  "created_by": "https://api.calendly.com/users/AAAAAAAAAAAAAAAA",
  "payload": {
    "uri": "https://api.calendly.com/scheduled_events/AAAA/invitees/AAAA",
    "name": "John Doe", "email": "test@example.com", "status": "active", "timezone": "America/New_York",
    "event": "https://api.calendly.com/scheduled_events/AAAA",
    "cancel_url": "https://calendly.com/cancellations/AAAA", "reschedule_url": "https://calendly.com/reschedulings/AAAA",
    "rescheduled": false, "old_invitee": null, "new_invitee": null, "text_reminder_number": null,
    "questions_and_answers": [], "created_at": "...", "updated_at": "...",
    "scheduled_event": { "uri": "...", "name": "15 Minute Meeting", "status": "active",
      "start_time": "2019-08-24T14:15:22.123456Z", "end_time": "2019-08-24T14:15:22.123456Z",
      "event_type": "https://api.calendly.com/event_types/AAAA",
      "location": { "type": "physical", "location": "Calendly Office", "additional_info": "..." },
      "event_memberships": [ { "user": "...", "user_email": "user@example.com", "user_name": "John Smith" } ],
      "event_guests": [], "invitees_counter": { "active": 0, "limit": 0, "total": 0 } },
    "tracking": { "utm_campaign": null, "utm_source": null, "utm_medium": null, "utm_content": null, "utm_term": null, "salesforce_uuid": null } } }
```
(`first_name`/`last_name` also present per docs search summary, null when a single name field is used; not in this sample.)

**Signature**: header `Calendly-Webhook-Signature: t=<unix>,v1=<hex>`; expected = HMAC-SHA256(signing_key, `${t}.${rawBody}`), hex; reject if `t` older than tolerance (docs example 3 min). **Delivery**: connect timeout 10 s, read timeout 15 s; non-2xx (3xx/4xx/5xx) retried with exponential back-off for up to 24 h, then subscription `state` becomes `disabled` and must be recreated.

**Not verified**: whether `name`/`email` query params on `data-url` prefill inside the iframe embed is officially stated (help docs show them on the scheduling link; the embed article routes prefill through the JS `prefill` object). Verify in a browser.

---

## 7. Model Context Protocol TypeScript SDK

**Docs read**
- https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md (v2, current)
- https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/README.md and .../v1.x/docs/server.md (v1 maintenance line)
- https://modelcontextprotocol.io/docs/develop/build-server (TypeScript tab)
- npm registry metadata: `@modelcontextprotocol/server` latest **2.4.0** (deps `zod ^4.2.0`, `@modelcontextprotocol/core 2.4.0`); `@modelcontextprotocol/sdk` latest **1.32.2** (peer `zod ^3.25 || ^4.0`).

**Current major = v2** (released 2026-07-27, implements MCP spec 2026-07-28). Packages: `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, optional `@modelcontextprotocol/node|express|fastify|hono`. v1.x (`@modelcontextprotocol/sdk`) gets fixes for at least six months after v2.

**v2 install**: `npm install @modelcontextprotocol/server zod`

**v2 minimal server (verbatim from README)**
```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'greeting-server', version: '1.0.0' });

server.registerTool(
    'greet',
    {
        description: 'Greet someone by name',
        inputSchema: z.object({ name: z.string() })
    },
    async ({ name }) => ({
        content: [{ type: 'text', text: `Hello, ${name}!` }]
    })
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main();
```
- `registerTool(name, { title?, description?, inputSchema, outputSchema? }, handler)`; `inputSchema` is a full `z.object(...)` (Standard Schema; Valibot/ArkType also work). Handler returns `{ content: [{ type: 'text', text }], structuredContent? }`.
- modelcontextprotocol.io's tutorial prefers the factory form for stdio so both protocol eras are served: `import { serveStdio } from "@modelcontextprotocol/server/stdio"; serveStdio(createServer, { onerror })` where `createServer()` returns a fresh `McpServer`. The README notes `server.connect(new StdioServerTransport())` still compiles but only serves 2025-era clients.

**v1.x equivalent** (if pinning `@modelcontextprotocol/sdk@1.32.2`; `npm install @modelcontextprotocol/sdk zod`)
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'my-server', version: '1.0.0' });
server.registerTool(
    'calculate-bmi',
    { title: 'BMI Calculator', description: 'Calculate Body Mass Index',
      inputSchema: { weightKg: z.number(), heightM: z.number() },   // v1: raw shape, not z.object
      outputSchema: { bmi: z.number() } },
    async ({ weightKg, heightM }) => {
        const output = { bmi: weightKg / (heightM * heightM) };
        return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    }
);
const transport = new StdioServerTransport();
await server.connect(transport);
```
Key v1 -> v2 differences: package name and import paths; `inputSchema` becomes a `z.object()` instead of a raw shape; zod v4 required in v2.

**Not verified**: whether the legacy `server.tool()` method still exists in v2 (README shows only `registerTool`); v2 migration guide not read in full.
