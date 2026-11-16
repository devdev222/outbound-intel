# Sales stack setup: Amplemarket, Attio, Clay, Trellus, Wiza

How the engine uses each tool, and the exact setup to turn each one on. Every adapter was built from the vendor's official docs (read 2026-11-16) and tested against recorded response shapes. **None has been run against a real account yet.** Run each connection test on the Integrations page, then one real end-to-end pass in a test workspace, before you rely on it.

## Who does what

| Engine step | Tool | Setting |
|---|---|---|
| Find accounts and their people | Amplemarket people search (or Clay tables, already supported) | `DISCOVERY_PROVIDER=amplemarket` |
| Buying signals (hiring, expansion, tech, pain) | Clay tables, or the native collector | `SIGNAL_SOURCE_*=clay` / `native` |
| Verify each person (work email, direct phone) | Wiza first, Amplemarket for what Wiza misses | `ENRICHMENT_PROVIDER=waterfall`, `ENRICHMENT_WATERFALL=wiza,amplemarket` |
| Run the sequences | Amplemarket (one lead per buying-group person) | `OUTREACH_PROVIDER=amplemarket` |
| Replies and steps back into the engine | Amplemarket JSON push | `AMPLEMARKET_WEBHOOK_SECRET` |
| Calls | Trellus dials Attio tasks; call results pulled from Trellus | `DIALER_PROVIDER=trellus` |
| CRM of record | Attio: history for learning, outcome write-back, owner check, deal changes back | `CRM_PROVIDER=attio` |

Put the settings in `.env.local` for local runs, or in your host's environment settings. Never commit keys.

## Attio (CRM)

1. **Enable Deals** (Settings → Objects) if it isn't on.
2. On **Deals**, add a **text attribute** with slug `external_deal_id` and mark it **unique**. The engine upserts deals on it, so a retried write never creates a second deal. To use a different slug, set `ATTIO_DEAL_MATCH_ATTRIBUTE`.
3. Create an **access token** (Settings → Developers) with these scopes:
   - records read-write
   - object configuration read
   - notes read-write
   - tasks read-write
   - workspace members read
   - webhooks read-write
4. Set:
   ```
   CRM_PROVIDER=attio
   ATTIO_API_KEY=...
   ATTIO_DEFAULT_OWNER_EMAIL=you@yourco.com   # Attio requires a deal owner
   ```
5. **Optional settings:**
   - `ATTIO_COMPANY_OWNER_ATTRIBUTE`: the slug of a custom "account owner" attribute on Companies. Without it, the owner check uses the owner of any open deal on the company that this app didn't create.
   - `ATTIO_STAGE_MAP`: our outcome to your stage title, as JSON. Default: meeting/opportunity → `In Progress`, won → `Won 🎉`, lost → `Lost`.
   - `ATTIO_STAGE_OUTCOMES`: your stage title to won/meeting/lost/no_response, used for learning.
6. **Webhook** (so deals moved in Attio count as outcomes): create one with `POST https://api.attio.com/v2/webhooks`:
   - Target: `https://<your app>/api/webhooks/attio`
   - Events: `record.updated` and `record.created`, filtered to Deals
   - Copy the `secret` from the response into `ATTIO_WEBHOOK_SECRET`. Attio shows it only once.
7. Run **Learn** on the Scoring model page to retrain on your Attio deals.

**What happens:**
- **Outcomes** (meeting, opportunity, won, lost) upsert the company (by domain), the person (by email) and the deal (by `external_deal_id`). Each also adds a note with the person, value and a link back to the account.
- **Replies** add only a note.
- **Accounts someone already owns in Attio** stay out of the rep queue.
- **Deals moved to won or lost in Attio** are recorded once on the matching account and are not written back to Attio.

**Not covered by the API:** Attio has no default close-date attribute (the stage change time is used) and no request idempotency keys. If a note write is retried after Attio accepted it, a second note can appear.

## Amplemarket (sequences, enrichment, discovery)

1. Create an **API key** (Settings → API) and set `AMPLEMARKET_API_KEY`.
2. **Build the sequence** the engine fills, and set `AMPLEMARKET_SEQUENCE_ID`.
   - Each step's template uses the engine's copy for that person: `{{oi_step_1_subject}}`, `{{oi_step_1_body}}`, `{{oi_step_2_body}}`, and so on, in step order.
   - Also available: `{{first_name}}`, `{{company_name}}`, `{{oi_page_url}}` and `{{oi_angle}}`.
   - The engine still writes the copy per person and per role, and Lab experiments still apply.
   - For a different sequence per role, set `AMPLEMARKET_SEQUENCE_BY_ROLE={"economic_buyer":"seq_...","champion":"seq_..."}`.
3. **JSON push** (Settings → Integrations → JSON data): choose sequence stages and replies, and send them to `https://<your app>/api/webhooks/amplemarket?token=<AMPLEMARKET_WEBHOOK_SECRET>`. Use a long random token, because Amplemarket doesn't sign payloads.
4. Set `OUTREACH_PROVIDER=amplemarket`.
5. **Optional:**
   - `DISCOVERY_PROVIDER=amplemarket` with `AMPLEMARKET_SEARCH_FILTERS` (JSON filters for people search, e.g. `{"person_titles":[...],"company_industries":[...],"company_sizes":["201-500 employees"]}`).
   - `AMPLEMARKET_REVEAL_PHONES=true` to spend phone credits during enrichment.

**What happens:**
- **Each verified buying-group person** is added to the sequence once, with their contact id in the lead data so every event comes back to the right person.
- **Leads Amplemarket skips** (recently contacted, already in a sequence, on an exclusion list) show as skipped with the reason.
- **Reply labels:**

  | Label | Result |
  |---|---|
  | interested | A reply: the others at the account are held and the rep gets a Coordinate task |
  | ooo | The person is held until their return date |
  | hard_no | The person is opted out and suppressed |
  | not_the_right_person | The person is replaced and history is kept |
  | forwarded / introduction | A rep task to add the new person |
  | asked to circle back | A rep task |

**Not covered by the API:**
- A lead can't be paused or removed from a sequence through the API. When the engine holds or pauses someone, pause them in Amplemarket too; the account shows that it couldn't.
- Opens, clicks, bounces and unsubscribes aren't pushed.
- Amplemarket enrichment doesn't say whether an email is valid, which is why Wiza goes first in the waterfall.

## Wiza (contact verification)

1. Create an **API key** (Settings → API) and set `WIZA_API_KEY`.
2. `WIZA_ENRICHMENT_LEVEL=full` (default) reveals email and phone. Use `partial` for email only.
3. Reveals that take longer than `WIZA_POLL_SECONDS` (default 20) finish on `https://<your app>/api/webhooks/wiza`. Wiza signs this callback with your key, so there is nothing to configure. The app URL has to be public HTTPS (`NEXT_PUBLIC_APP_URL`).

**What happens:**
- Only an email Wiza marks `valid` counts as verified; `risky` doesn't.
- A phone counts when Wiza reports it `found`.
- Billing problems stop retries and show on the person.
- Credits: 2 per valid email, 5 when a phone is found, nothing when nothing is found.

## Trellus (calls)

1. In Trellus, connect **Attio** (Integrations → Attio). Trellus then dials Attio tasks and writes outcomes and summaries back to Attio.
2. Create a Trellus **API key** (Settings → Integrations → API) and set `TRELLUS_API_KEY`.
3. Set `DIALER_PROVIDER=trellus`. This needs the Attio settings above, because calls are queued as Attio tasks.

**What happens:**
- **When Jerry flags a hot lead,** the call becomes an Attio task, assigned to the rep's email (or `ATTIO_DEFAULT_OWNER_EMAIL`), with the talk track as its content.
- **Every 5 minutes,** the Campaign Agent pulls the last `TRELLUS_SYNC_HOURS` (default 24) of calls from the Trellus Call Data API and matches each call to a person by phone number, then by name. Each call is recorded once, with its disposition and notes.
- **Do-not-call dispositions** opt that person out.
- **When Trellus detects a meeting was agreed,** the rep gets a "Confirm the meeting" task. The engine doesn't book it.

**Not covered by the API:**
- Trellus has no outbound webhooks, so call results are pulled.
- The Call Data API allows 2 requests per 4 seconds.
- Disposition labels are your own Trellus labels; the engine only interprets do-not-call.

## Clay

Already supported:
- Discovery tables: `DISCOVERY_PROVIDER=clay`.
- Signal collection: `SIGNAL_SOURCE_*=clay`.
- An enrichment table: `ENRICHMENT_PROVIDER=clay`, or `clay` as a step in `ENRICHMENT_WATERFALL`.

Setup is on the Integrations page and in `docs/WIRING.md`.

Clay also has native integrations with **Attio** (sync records) and **Wiza** (as an enrichment provider), if you'd rather run part of the waterfall inside Clay.

## Turning it on safely

1. Point the app at a test Attio workspace and a test Amplemarket sequence with your own address as the only lead.
2. Run each connection test on the Integrations page. They're read-only and spend no credits.
3. Run one account through end to end, checking each step:
   - discovery
   - Wiza verification on the Contacts section
   - the lead in Amplemarket
   - a reply from your own inbox
   - a meeting logged on the account
   - the deal and note in Attio
4. Then switch to the real workspace and sequence.
