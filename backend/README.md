# JigyaByte backend

Cloud migration (2026-10-13): Supabase now hosts the API and transferred backend data. See [deployment evidence](../supabase/deployment-status.md) and [cloud operation guide](../supabase/README.md). The recurring generation schedule and live generation probe remain pending explicit authorization. Keep the PC worker stopped after cutover; reconcile cloud usage and deliveries before returning to local generation.

The optional PC backend creates new cards with Gemini and syncs them to the phone's local SQLite library. Evergreen cards use model knowledge; news cards use recent material from free public endpoints. Gemini remains the only generation provider. AI summaries are unverified even when source links are attached.

## Card writing policy

Cards should deliver a “Wow, I didn't know that!” moment, spark a question or reflection, or teach a practical game/software development technique. Lead with one memorable detail or useful move. Keep titles inviting, summaries to one sentence, and explanations to 2–4 short conversational sentences. Avoid textbook definitions, research-paper voice, filler and heavy jargon outside game and software development. Prefer well-established claims Gemini can state confidently. Never invent names, numbers, dates or explanations to make a card sound surprising. The app labels the result Gemini-generated and unverified.

## Supported topics

The original ten topics remain available. The expanded catalog adds Literature, Tech Tips, Game Industry Stories, AI Updates, Agentic Coding, Game Industry News, Indie Games, Current Affairs, General Knowledge, and Cinema (Bollywood & Hollywood). These participate in discovery rotation and can be selected as interests in the updated app. Each new topic has specific writing guidance, including actionable tips, established industry stories, uncommon general facts and cinema details from both industries.

The catalog also includes Ancient History (`ancient-history`), Indian History (`indian-history`), Ancient India (`ancient-india`), Indian Myths and Epics (`indian-myths-and-epics`), Art (`art`), Product Design (`product-design`), and UX (`ux`), for 27 topics in total. Philosophy (`philosophy`) retains its existing ID and now has explicit guidance for approachable ideas and thought experiments from Indian and global traditions. These are evergreen topics in the same balanced generation pool. History guidance separates evidence from disputed claims; myths and epics are attributed to their texts or traditions and are not presented as verified history.

AI Updates, Game Industry News and Current Affairs require recent retrieved evidence when live sources are enabled (the default). Sources are PIB RSS plus up to three linked official releases, UN News RSS, GDELT Context snippets, a randomly chosen GitHub release repository, and two Steam announcement feeds (one broad/indie game and one frequently updated game). These require no paid API, search, grounding service or additional key. Only official Steam announcements are used. No general article scraping or paywall bypass is implemented.

Responses, including failures, are cached for one hour and concurrent fetches are coalesced. Sources need at least 80 characters of context, a valid HTTPS link and a date within seven days; future dates beyond a five-minute clock allowance are rejected. Headline-only items are skipped. GDELT's observation date is labeled Indexed, not Published or an event date. Source outages skip affected news topics and continue evergreen generation. Endpoint status appears in authenticated `/v1/status`.

Gemini receives bounded excerpts as untrusted data and may cite only supplied IDs. The backend attaches actual URLs/dates, rejects invented, mismatched or repeated references, and requires sources for news cards. The app saves references offline and shows clickable links in details. Cached news older than seven days is not offered to another device; phone cards and favorites remain readable. All summaries remain AI-generated and unverified.

An updated app is needed to accept new topics and referenced cards. Existing installations seed additional topic rows without resetting cards, interests or history. Older builds reject unfamiliar IDs and nonempty references. New generation uses prompt version 6.

## Setup

Use Node.js 24.13 or newer. For a new setup, copy the template and configure the private environment file:

```powershell
Copy-Item backend/env.example backend/.env
```

Set `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_FALLBACK_MODELS`, `BACKEND_DEVICE_TOKEN`, and the PC's LAN address in `backend/.env`. The current model chain is `gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite`. The singular setting keeps the first fallback for compatibility; the plural setting appends comma-separated models in order. Model IDs must be distinct; at most seven fallbacks are accepted. Keep `ALLOW_PAID_CALLS=false`; generation remains disabled until the provider, model and free-tier confirmation are explicitly configured. Keep the key in `.env`; the phone receives only the separate pairing token.

Start the server from the project root when you choose to run it:

```powershell
npm run backend
```

Use Ctrl+C to stop it cleanly. The server is currently expected to remain stopped until the user starts it.

For Android, set `BACKEND_HOST` to the PC's private Wi-Fi IPv4 address and connect the phone to the same network. In **Topics → Backend connection**, enable automatic refill, enter `http://<PC-Wi-Fi-IPv4>:4319`, and provide `BACKEND_DEVICE_TOKEN`. For USB, run `adb reverse tcp:4319 tcp:4319` and use `http://127.0.0.1:4319`. The app stores the pairing token in SecureStore. Never enter the Gemini key on the phone.

## Generation and recovery

The backend fills an output-sized batch per request and caches surplus instead of spending a request on each small phone deficit. `GENERATION_BATCH_SIZE` defaults to 30 (maximum 60); the effective count is capped by `floor((MAX_OUTPUT_TOKENS - 512) / 350)`, minimum one. The current 8,192-token ceiling targets up to 21 cards/request; the 4,096-token example targets ten. This is an estimate, not a guarantee of provider output. Batches shrink to fit input limits, remaining daily tokens and cache space. Durable deliveries remain at most ten cards and the phone keeps its 60-unread target.

Topic selection randomly breaks ties among the least-generated available topics. Counts persist across requests and restarts, keeping coverage even without fixed rotation or interest weighting. The phone's discovery/interest/review lanes remain. Cached delivery cards are randomly selected once, then persisted unchanged for lost-response retries. News topics rejoin when fresh unused evidence is available.

The explicit fallback chain advances after quota, overload, network or model-configuration failures, trying each configured model once. Backoff is approximately 10/20/40 seconds plus jitter for the current four-model chain, respecting longer provider Retry-After values. The three-attempt ceiling applies only to a single-model setup, so it cannot prevent the fourth model from being reached. Each attempt reserves a separate request. A timeout without another configured route stays uncertain for explicit Retry. Bad credentials, refusals, incomplete responses and malformed output fail without automatic retries to avoid wasting requests. Retry never resets usage and no alternate provider is called.

The example limits are ten requests/day and 50,000 reserved tokens/day. The private setup uses 30-request and 725,760-token caps, a 16,000-byte input bound and an 8,192-token output ceiling; paid calls stay disabled. Each reservation uses actual prompt/schema UTF-8 bytes as a conservative input-token bound plus the output limit sent to Gemini, rather than reserving unused input capacity. If remaining daily tokens cannot fit a full batch, both card count and requested output ceiling shrink. Valid cards from a partly bad response are retained without a repair request. Provider-reported usage stays in diagnostics; failures do not refund reservations. Google's quotas apply independently. The UTC ledger is never reset to evade a cap.

## Additional candidates (investigated, not enabled)

Gemma 4 is hosted on the same Gemini API with IDs `gemma-4-26b-a4b-it` and `gemma-4-31b-it`. Google's current pricing lists free-tier input/output. Both metadata endpoints are accessible with the configured key. One approved card-schema probe on 2026-10-13 succeeded for 26B; 31B returned HTTP 503, so successful generation remains unverified. Gemma needs a model-specific thinking setting: `minimal` (off) or `high` (on), rather than the current Gemini `low`. Neither is in the active fallback list.

Antigravity agent is available in preview on free-tier projects via the separate Interactions API. It supports web research but lacks structured outputs, so integration requires a dedicated adapter, output validation and agent-token budgeting. It is not configured or called. See [Antigravity API documentation](https://ai.google.dev/gemini-api/docs/antigravity-agent), [hosted Gemma documentation](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) and [current pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Data and migrations

The phone's SQLite database remains authoritative for its cards and user state. The backend stores a bounded card cache, delivery/job state, duplicate history, device snapshots and usage reservations.

Backend database version 7 adds source caching, used-source IDs and topic-generation counts without clearing cards, deliveries, history, jobs or usage. Source-cache rows expire after 14 days. Backend versions 5–6 previously reset the retired cache. App schema stays version 7; references use existing columns, so no phone reset is needed.

## Checks and diagnostics

```powershell
npm run backend:typecheck
npm run backend:test
npm --prefix backend run diagnose:sources
npm --prefix backend run diagnose:gemini
```

Tests use local/mocked data. `diagnose:sources` fetches public sources into an in-memory database without environment secrets, Gemini requests or usage-ledger changes. A successful probe does not guarantee every endpoint is reachable. `diagnose:gemini` is a deliberate real provider request, within the configured budget while the backend is stopped. `prewarm` also makes provider requests when the cache is empty.

The app remains readable when the backend or internet is unavailable. A successful TypeScript check or fixture test does not establish live Gemini availability, returned fact accuracy, or Android visual acceptance. See [../docs/manual-test.md](../docs/manual-test.md) for the current device checklist.
