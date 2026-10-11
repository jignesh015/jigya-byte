# JigyaByte backend

The optional PC backend is the only path that creates new cards. It sends structured requests to the Gemini API and syncs cards to the phone's local SQLite library. It does not fetch Wikipedia or any other reference source, and it does not use a local or alternate model. Gemini-generated facts have no live citations and are unverified.

## Card writing policy

Cards should deliver a “Wow, I didn't know that!” moment, spark a question or reflection, or teach a practical game/software development technique. Lead with one memorable detail or useful move. Keep titles inviting, summaries to one sentence, and explanations to 2–4 short conversational sentences. Avoid textbook definitions, research-paper voice, filler and heavy jargon outside game and software development. Prefer well-established claims Gemini can state confidently. Never invent names, numbers, dates or explanations to make a card sound surprising. The app labels the result Gemini-generated and unverified.

## Setup

Use Node.js 24.13 or newer. For a new setup, copy the template and configure the private environment file:

```powershell
Copy-Item backend/env.example backend/.env
```

Set `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `BACKEND_DEVICE_TOKEN`, and the PC's LAN address in `backend/.env`. The current model chain is `gemini-3.8-flash` → `gemini-3.6-flash`. Keep `ALLOW_PAID_CALLS=false`; generation remains disabled until the provider, model and free-tier confirmation are explicitly configured. Keep the key in `.env`; the phone receives only the separate pairing token.

Start the server from the project root when you choose to run it:

```powershell
npm run backend
```

Use Ctrl+C to stop it cleanly. The server is currently expected to remain stopped until the user starts it.

For Android, set `BACKEND_HOST` to the PC's private Wi-Fi IPv4 address and connect the phone to the same network. In **Topics → Backend connection**, enable automatic refill, enter `http://<PC-Wi-Fi-IPv4>:4319`, and provide `BACKEND_DEVICE_TOKEN`. For USB, run `adb reverse tcp:4319 tcp:4319` and use `http://127.0.0.1:4319`. The app stores the pairing token in SecureStore. Never enter the Gemini key on the phone.

## Generation and recovery

The backend generates up to ten distinct cards in one structured Gemini request, subject to current demand, cache capacity and request/token limits. The prompt excludes recent titles and asks for easy-to-digest, curiosity-first facts. The server validates structure and topic tags, deduplicates ideas, stores the actual Gemini model on each card, and syncs through durable deliveries.

The explicit Gemini fallback chain advances once from the primary to the configured fallback after a provider/model failure, including an ambiguous network timeout. Each attempt has its own reservation and bounded backoff. If the fallback also times out, the job remains uncertain for explicit Retry; Retry does not clear or reset usage. Provider refusals, bad credentials, quota exhaustion and upstream errors appear in backend status. The chain never calls a different provider.

The example limits are ten requests/day and 50,000 reserved tokens/day. The current private setup uses a 15-request daily cap and 362,880 reserved tokens/day with a 16,000-byte conservative input bound and an 8,192-token output ceiling. These are local limits, separate from Google's own quotas. The daily usage ledger is persisted by UTC date and must not be reset to evade a limit.

## Data and migrations

The phone's SQLite database remains authoritative for its cards and user state. The backend stores a bounded card cache, delivery/job state, duplicate history, device snapshots and usage reservations.

Backend database version 6 clears old cached card bodies and delivery payloads and drops the cached-source table once. It preserves duplicate/history records, jobs and every usage reservation. App database version 6 previously cleared the old card library; version 7 removes the retired local-generator setting while preserving current app state. The backend does not delete phone data.

## Checks and diagnostics

```powershell
npm run backend:typecheck
npm run backend:test
npm --prefix backend run diagnose:gemini
```

Type checks and automated tests use local or mocked data. `diagnose:gemini` is a real provider request and must only be run deliberately, within the configured budget, while the backend is stopped; it is not a way to bypass daily limits. `npm --prefix backend run prewarm` also makes provider requests when the cache is empty.

The app remains readable when the backend or internet is unavailable. A successful TypeScript check or fixture test does not establish live Gemini availability, returned fact accuracy, or Android visual acceptance. See [../docs/manual-test.md](../docs/manual-test.md) for the current device checklist.
