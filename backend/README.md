# JigyaByte backend

Latest local budget update (2026-10-11): user-approved `DAILY_REQUEST_LIMIT=15`; companion `DAILY_TOKEN_LIMIT=362880` permits 15 attempts at the unchanged 16,000 input + 8,192 output reservation bounds. Existing usage is preserved. These are backend limits, independent of Google's quotas. Paid calls and OpenAI fallback remain disabled. Earlier 12-request exhaustion evidence below describes the previous cap.

Current fallback policy (2026-10-11): the user explicitly approved another free Gemini model and chose to keep OpenAI disabled after clarification that ChatGPT Plus does not include API-key usage. The private `.env` sets `GEMINI_FALLBACK_MODEL=gemini-3.6-flash`, so the active order is Gemini 3.8 Flash → Gemini 3.6 Flash. Google's current pricing lists standard generation free for both models; this setup uses the user's confirmed billing-disabled project. Quotas and availability still apply. OpenAI's quickstart model, `gpt-6-astra`, is configured in `.env`, with `OPENAI_FALLBACK_ENABLED=false` and paid calls still blocked. Keys remain only in `.env`.

On a definitive HTTP 429 or 5xx generation error, the worker advances to the next configured route after its bounded backoff (honoring Retry-After). Each route is tried once when a fallback chain exists; it never cycles between models. Source retrieval errors retry retrieval without advancing the model. Credential/configuration errors, refusals, invalid card output, duplicates and ambiguous timeouts do not trigger fallback. A successful response still supplies up to ten cards in one request. Request/token/cost reservations are shared across the entire chain and never reset by switching models or pressing Retry.

SQLite version 4 persists `provider_index` and a sanitized `attempt_log`, so queued fallbacks survive a restart. Actual model/provider provenance is attached to generated cards; `/v1/status` exposes the active configured `fallbackChain` without keys. Explicit manual Retry starts the chain again while preserving all reservations. An ambiguous paid OpenAI request cannot be retried through the free-Gemini exception.

OpenAI remains an optional second fallback in the code. Enabling it later requires deliberate `OPENAI_FALLBACK_ENABLED=true`, `ALLOW_PAID_CALLS=true`, a server key/model, and approved positive `DAILY_COST_LIMIT` / `MAX_REQUEST_COST`. For a confirmed free Gemini project, Gemini routes remain zero-cost reservations while OpenAI reserves the approved maximum per attempt. Recheck model pricing and set a conservative input/output/reasoning cost bound before enabling any paid route. No paid requests were made to verify this change.

Official model/billing references: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI quickstart](https://developers.openai.com/api/docs/quickstart), [ChatGPT Plus and API usage](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus).

Exact Gemini diagnosis (2026-10-11): two bounded ten-card preparation probes returned HTTP 503, status `UNAVAILABLE`, message `This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.` One used the original thinking setting; the other used explicit `low`. This confirms capacity overload for these probes; the discarded historical HTTP bodies/finish reasons cannot be reconstructed. A historical `provider_refused_or_incomplete` is not proof of token exhaustion or a safety refusal.

Provider errors now retain sanitized HTTP status/message and successful-response finish reason/token counts in the job's `diagnostics` field (backend SQLite version 3). Prompts, output bodies, thought text and keys are excluded. Retries wait roughly 10 and 20 seconds plus jitter, honor Retry-After, and remain limited to three attempts. The private `.env` selects `GEMINI_THINKING_LEVEL=low` for this Gemini 3 model; this reduces default reasoning effort without increasing the 8,192-token output cap or changing models. Live low-thinking success remains unverified because the capacity error persisted. Tests cover exact overload diagnostics, redaction, MAX_TOKENS metadata and longer backoff.

The diagnostic probes used the final two remaining daily reservations. Total reservations are 12 requests / 290,304 tokens / zero configured monetary cost; the request cap now prevents additional calls until the UTC daily reset (05:30 IST). Provider billing/actual usage was not independently audited. The existing backend is restored and cached reading remains available.

For a future single-request reproduction, stop the backend and run `npm --prefix backend run diagnose:gemini` from the project root. It requires confirmed free Gemini, existing fetched/licensed sources, unchanged available budgets, and exclusive ownership of the backend port. It makes one request without automatic retries, validates successful cards before adding them to the cache, and prints only sanitized diagnostics/counts. Do not run it to circumvent a daily cap.

Latest recovery check (2026-10-11): the old Retry skipped uncertain jobs. Explicit free-Gemini retry now reaches the server and preserves all reservations; paid-mode uncertain calls remain blocked. The Samsung button started generation successfully, but Gemini returned server errors through three bounded attempts. Latest live inventory is still 12 unread; this is provider failure, not successful refill. Local timeout is now 60 seconds. Android surfaces the specific error rather than a generic “needs attention” message.

Implemented server foundation: Node 24.13+, TypeScript, built-in SQLite, authenticated version-1 sync, durable cache/deliveries/jobs, Gemini/OpenAI REST adapters, Wikipedia retrieval, validation/deduplication, and persistent request/token/cost reservations. There are no production fixture cards and no automatic startup model calls. The existing Ollama service on 4318 remains available.

The Android app now connects through Topics → Backend connection. Its version-4 SQLite migration preserves history, Favorites and review dates, persists queue assignments, caps read non-favorite bodies at 30, and saves delivery acknowledgments with imports. The pairing token is held by Expo SecureStore. Backend code never deletes phone data or enforces phone retention. Repository tests and actual phone evidence are recorded separately in `docs/manual-test.md`.

## Setup

### Desktop launcher (Windows)

Run `npm run backend:launcher` from the project root to create
`artifacts/backend-launcher/JigyaByte Backend.exe`. Copy just this EXE to your desktop.
Double-click it to start the backend using the existing `backend/.env` and database.
Keep its console window open; Ctrl+C stops the server cleanly, then Enter closes the
window. Closing the window also terminates the server, but Ctrl+C is preferred when
a request is in progress. If the backend is already healthy, the launcher reports
that and leaves the existing server running.

This is a launcher for this PC: Node.js 24.13+ and the project folder are still
required. It embeds the project and Node paths, never keys. Source/configuration
changes take effect on the next launch; rebuild the EXE if either path moves.
USB phone connections still need `adb reverse tcp:4319 tcp:4319` after reconnecting.

From the project root:

```powershell
# Optional: development tools; runtime has no third-party dependencies.
npm --prefix backend ci
# Only if .env does not already exist:
Copy-Item backend/env.example backend/.env
# Generate a pairing token if using a fresh template, and enter it in BACKEND_DEVICE_TOKEN:
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
npm run backend
```

The local `.env` already created during implementation contains a random pairing token. **Enter your Gemini key at `GEMINI_API_KEY=` in `backend/.env` (line 2)**. Do not paste it into the phone, an `EXPO_PUBLIC_*` variable, source files or chat. `.env` and `data/` are ignored. Keys travel in provider authentication headers and never in URLs, responses or logs. Model and budget changes require a server restart; the server loads this file independently of Expo.

Adding a key alone does not enable calls. Keep `GENERATION_PROVIDER=disabled` until the selected provider/model/cost mode is deliberately confirmed. `GEMINI_MODEL` and `OPENAI_MODEL` intentionally have no code default. For this user's current local setup, Gemini `gemini-3.8-flash` was selected from Google's quickstart after the user requested the default model, and the user confirmed a free-tier project with billing disabled. The local `.env` enables Gemini source-grounded preparation with paid calls blocked, up to 12 requests/day, 300,000 reserved tokens/day, a 16,000-token conservative input bound and 8,192 output tokens per request. These bounded values allow an up-to-ten-card-per-request refill; upstream quotas may still prevent reaching the target.

To activate Gemini after confirming the specific model/account has a non-billed free tier, set the key, explicit model ID, `GENERATION_PROVIDER=gemini`, and `GEMINI_FREE_TIER_CONFIRMED=true`; leave `ALLOW_PAID_CALLS=false`. Choose `CONTENT_MODE=ai-only` for explicitly unverified AI cards, or `source-grounded` for generation using fetched Wikipedia excerpts. The server never silently changes modes/providers. A free-tier confirmation is a local operator assertion, not something the backend can independently verify.

Paid mode is only for a separately approved provider/model/spend configuration. It requires `ALLOW_PAID_CALLS=true`, positive `DAILY_COST_LIMIT`, and a positive, conservatively calculated `MAX_REQUEST_COST`. Unknown pricing must leave paid mode disabled. That per-request upper bound must account for input, output, reasoning and all provider charges; the server reserves it before each attempt rather than guessing prices. No search/grounding tools are enabled. OpenAI is blocked in free-only mode.

Consult current official [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini generateContent structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output), and [OpenAI Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) when choosing a supported model. Free eligibility, quotas and model support can change. No live model call or billing activation occurred during implementation.

## Protocol

`GET /health` is public and never generates. Every other endpoint requires `Authorization: Bearer <BACKEND_DEVICE_TOKEN>`. This pairing token is separate from upstream keys. This is a single-user, shared-token local service, not a multi-user backend.

| Route | Body / behavior |
| --- | --- |
| `GET /v1/status` | Provider, mode, cache count, durable jobs and reserved daily budgets. No secrets. |
| `POST /v1/sync` | Complete versioned inventory below. Returns cached delivery, event acknowledgment IDs and refill state/job ID. |
| `POST /v1/deliveries/{id}/ack` | `{ "inventory": <fresh snapshot>, "acceptedIds": [], "rejectedIds": [] }`. IDs must partition the delivery. Accepted cards need matching committed ID/hash or read-history proof. |
| `GET /v1/jobs/{id}` | Job state, attempts, safe error code. Call sync for completed cards. |
| `POST /v1/jobs/{id}/retry` | Explicit retry of a failed job after fixing its cause. Rechecks demand and budgets; refuses running jobs; uncertain jobs require an explicit Retry and confirmed non-billed Gemini mode. |
| `POST /v1/history/batches` | `{ "protocolVersion": 1, "deviceId": "installation-id", "events": [...] }`. Idempotent batches; response acknowledges event IDs. |

Example empty-library snapshot:

```json
{
  "protocolVersion": 1,
  "deviceId": "persisted-installation-id",
  "inventoryVersion": 1,
  "snapshotComplete": true,
  "counts": { "unread": 0, "readNonFavorite": 0, "favorites": 0 },
  "interestTopicIds": ["game-design", "space"],
  "retainedCards": [],
  "historyEvents": [],
  "pendingDeliveryIds": []
}
```

Retained references contain `id`, `contentHash`, `read`, `favorite`, and optional `ideaFingerprint`. History events contain `eventId`, `id`, `contentHash`, `primaryTopicId`, `seen`, `expanded`, and optional `ideaFingerprint`. Backfill all historical identities through history batches **before the initial sync** so evicted cards are excluded. Persist event IDs and retry until explicitly acknowledged; cursor-based pagination is not implemented. Snapshots must be complete (up to 2,000 references and 512 KiB per request); incomplete/paginated inventory is rejected instead of authorizing generation. Large-library paginated snapshots are a future protocol extension.

Increment inventory version after each local transaction changing inventory/preferences. Older snapshots return 409; changing inventory without incrementing returns 409. Unread favorites overlap counts but are one body. Phone counts are validated against actual complete references, and delivered cards never increment reported unread on the server.

At <=55 unread, supply toward 60 from cache, up to ten cards per delivery. One pending delivery and one active refill job per installation prevent duplicate reservations. Pending deliveries are returned unchanged until acknowledged. Import into phone SQLite and persist its acknowledgment outbox in the same transaction; acknowledgment needs a newer inventory version. Rejected identities are excluded from future supply. A lost response can be safely retried.

When cache is empty, a sync may enqueue at most ten cards. The worker rechecks current demand before source retrieval and model dispatch, then stores validated cards before completion. Pending deliveries stop further generation until acknowledged. After completing a batch, the worker does not autonomously generate another: the next sync drives supply. At >55 unread no new refill cycle is started; a persisted cycle already started at <=55 continues until fresh snapshots report 60. For example, 47 becomes 57 after a ten-card import and then receives three more.

Daily budgets use UTC date boundaries and survive restarts. Each attempt reserves one request, `MAX_INPUT_TOKENS + MAX_OUTPUT_TOKENS`, and the configured maximum cost; reservations are deliberately conservative and never refunded after dispatch. Input size is conservatively bounded by UTF-8 bytes of prompt/schema. Output token ceiling includes the provider's output budget; choose a supported model and verify its token accounting before paid activation. Defaults: ten requests/day, 50,000 reserved tokens/day, zero dollars. Retryable 429/5xx and retrieval network failures have at most three attempts with exponential backoff/jitter and Retry-After; 401/403/configuration/refusal failures require correction and explicit retry. Ambiguous model timeouts are never automatically repeated.

SQLite restart recovery restores deliveries, cache and queued jobs. A job interrupted while running becomes `uncertain` to prevent another possibly charged call. Inspect its provider-side result/usage before locally reconciling it; no automatic lease expiration can authorize replacement. Explicit user retry can replace an uncertain request only for confirmed free Gemini with paid calls disabled, preserving both the original and replacement reservations. There is no reconciliation UI yet. Cache is capped separately at 500 cards and stops further generation at capacity; cache pruning/admin tooling is a later extension. Exact normalized-content hashes, title fingerprints and title/summary token overlap reject duplicate cached ideas; this heuristic is not a guarantee of semantic deduplication.

## Phone connection

Loopback is default. USB: `adb reverse tcp:4319 tcp:4319`, then open Topics → Backend connection on Android. Enable automatic refill, use `http://127.0.0.1:4319`, and enter the local `BACKEND_DEVICE_TOKEN` as the pairing token. Save interests/settings. The token is saved in platform secure storage; never enter a Gemini/OpenAI key on the phone. The UI shows authoritative unread count, provider/model, refill/shortage state and Retry. Resume/read/favorite/import events coalesce into a single sync; pending jobs poll while the app is foregrounded. Cached reading never waits for the PC. Retry explicitly retries failed jobs without clearing provider budgets; uncertain calls can be explicitly retried only in confirmed free Gemini mode; their original budget reservations remain charged against local limits. Paid-mode uncertain calls remain blocked for reconciliation.

The connected Samsung was configured over USB during this implementation. USB forwarding must be restored after reconnecting or restarting ADB. LAN requires explicit `BACKEND_HOST` configuration and a private-network firewall rule. Review transport security before wider hosting.

## Verification and troubleshooting

```powershell
npm run backend:test
npm run backend:typecheck
npm --prefix backend run diagnose:wikipedia
# Optional one-batch cache prewarm, only after activation is approved:
npm --prefix backend run prewarm
```

Tests use temporary/in-memory SQLite and mocked model responses, never the real `.env` or live model APIs. SQLite is experimental in this Node release and emits a startup warning.

The separate live prewarm check first encountered Wikipedia 429, then resumed after backoff and successfully cached five Gemini-prepared cards from fetched, attributed Wikipedia sources. Only the successful dispatch reserved a model request. Model metadata confirmed `gemini-3.8-flash` supports `generateContent`. This is separate from automated mocks and does not resolve the old direct-phone Wikipedia 403.

During Samsung refill, five model requests completed and produced 25 cached cards. A sixth request timed out and remains `uncertain` with `upstream_timeout_or_network`; automatic generation stopped. Phone acknowledgments reported 26 committed unread cards, with no pending deliveries. The live 50/60-card target is therefore still unmet. Do not clear budgets, delete the job or automatically redispatch it: inspect provider-side usage/result before manual reconciliation. Cached reading and the already imported cards remain available. Full evidence and remaining device checks are in `../docs/manual-test.md`.

PC diagnostics on 2026-10-10 reproduced the exact phone provider's search/metadata/summary paths using both header styles: the phone-style search returned 429 while metadata/summary returned 200; backend-style requests returned 200 for all three. This does **not** reproduce or resolve the reported phone 403. Header style and request timing both differed, so these results do not establish its cause. The retrieval adapter surfaces 403 without a fallback or an access-control workaround, and requires fetched license metadata before preparing sourced cards.

`disabled` means cache-only mode. `budget_exhausted` means configured persistent reservations were consumed. `quota_exhausted` means bounded rate-limit retries were exhausted. `degraded` includes retrieval errors, invalid output, interrupted calls, or full cache. Fix credentials/model/quota configuration and explicitly retry failed jobs; uncertain paid-mode jobs require manual reconciliation; confirmed free Gemini jobs support explicit user retry.

For backup, stop the backend cleanly and copy `backend/data/`; keep `.env` separately private. Clean shutdown lets active requests finish before closing SQLite. Resetting backend data loses cache, deliveries, dedup history and budget reservations, so do not reset during outstanding requests/deliveries or to circumvent daily limits. No phone data is reset by this server.
