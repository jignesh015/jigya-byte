# Deployment evidence

## Rolling card cache update, 2026-10-18

- Set hosted `MAX_CACHE_CARDS=5000` with Supabase CLI and deployed both `jigyabyte-api` and `jigyabyte-worker` successfully.
- The server now accepts refill jobs at cache capacity. On each distinct insertion, it evicts the oldest cached card first, keeping the backend pool capped at 5,000. Pending delivery payloads and phone SQLite cards are preserved.
- Read-only post-deploy checks returned health HTTP 200 (`ready:true`) and authenticated status HTTP 200 (`migrationReady:true`). Gemini remains configured in AI-only mode. Usage remained 1 request, 13,458 reserved tokens, cost 0; deployment did not invoke generation.
- Backend TypeScript typecheck and `git diff --check` passed. No provider call or generation probe was run.

App follow-up, 2026-10-14: automatic successful syncs with no imported cards no longer produce a library-up-to-date toast. Manual refresh retains confirmation; automatic new-card deliveries show only the added-card message. App typecheck and lifecycle/fixture integration checks passed. Updated ARM64 APK SHA256 `3b38a614e3417326b03a4a0dbdaa7ba118dcece874d30a3bfc244b3120739462` was installed in place on Samsung `R5CT2370GBT` and launched. At that time, the October 14 backend rollout below was unchanged.

Verified current rollout:

- Applied the private `model_cooldowns` migration and deployed both updated functions. Cards, device snapshots, delivery/ACK state and usage reservations were preserved.
- Enabled the one-minute due-job worker schedule with the existing Vault credential. Its SQL calls the worker only for due queued jobs or expired running leases; idle ticks do not invoke a function. The schedule is confirmed active and execution succeeded. Paid calls remain disabled; global caps remain 30 attempts and 725,760 reserved tokens per UTC day.
- Hosted compact authenticated handshake returned HTTP 200 with a 235-byte body, compared with 30,670 bytes for full diagnostic status. Phone traffic now uses the compact route on foreground/resume, every five minutes while active and manual refresh; card/history sync reuses that handshake. Pending generation polls once per minute.
- Live job 47 received HTTP 503 from Flash 3.8 and Flash 3.6, persisted both one-hour cooldowns, then completed on Flash-Lite 3.5. New jobs 48 and 49 each dispatched only one attempt at route 2, skipping both cooling models. Their original failure timestamps remained unchanged. Live generation cost recorded as zero.
- Backend regressions: 44 passed. Cloud/Postgres regressions: 6 passed, including cooldown persistence, no budget charged for skips, compact status, fencing and diagnostic object serialization. App/backend typechecks, cloud runtime checks, app data/feed/lifecycle/HTTP fixture checks and publication audit passed.
- Final ARM64 APK built at `artifacts/JigyaByte.apk`, SHA256 `ea08d31c7335ebd7a7cdfb3747c9a2805a574db75867266d36b62427a277d069`. Installed in place on Samsung `R5CT2370GBT` and launched. Existing phone data remains intact.
- Phone checks confirmed global top toast over Settings, Favorites and Analytics; tapping leaves it visible; left and right swipes dismiss it. Manual refresh showed the rotating icon and a subsequent stopped/enabled button, updated daily usage and a friendly new-card response. Hosted generated cards arrived on the phone. Duplicate refresh locking, background timer cancellation, failure messages and last-handshake color were verified with controlled app lifecycle fixtures; no forced phone network outage was used.

The earlier pending cron/live-generation/APK-install items below are historical and superseded by this rollout. Extended offline, all-screen accessibility and five-minute physical heartbeat acceptance remain manual checks; controlled tests establish the timer and cancellation logic.

## Initial migration evidence, 2026-10-13

Project `fuomvvzgdhleikztdpgz` (`jigya-byte`, Mumbai/ap-south-1) was verified ACTIVE_HEALTHY through the authenticated CLI.

Completed:

- Applied private Postgres schema through authenticated Management API SQL.
- Uploaded approved free Gemini configuration, with paid calls disabled, and separate random device/worker tokens.
- Deployed `jigyabyte-api` and `jigyabyte-worker`; functions use the injected database URL.
- Took a consistent private SQLite backup and imported 197 cards, 5 devices, 1,531 history events, 62 deliveries, 47 jobs, 4 usage rows, 20 source-cache rows, 27 topic counters and 10 source identities. One stale running job was imported as uncertain, retaining its reservations. The original local database was not rewritten.
- Verified hosted health and authenticated status (HTTP 200), migration-ready state, 197 cached cards, and today's preserved usage: 9 requests, 155,252 reserved tokens, cost 0.
- Hosted cached-card probe passed: unauthorized access rejected, phone token rejected by worker, ten-card delivery, identical lost-response retry, and idempotent ACK. Removed only the probe device state afterward.
- Five Deno/Postgres regression tests passed for transaction rollback, snapshot/ACK conflicts, concurrent claims/budgets, claim fencing, fallback routes, timeout recovery and migration barrier. All 43 existing backend tests passed. App/backend typechecks passed.
- Feed/data regression checks passed. The app/backend fixture integration passed with local network access, including cloud URL validation; a sandbox-restricted run had failed at its simulated lost-ACK assertion before the successful rerun.
- Android ARM64 release APK built at `artifacts/JigyaByte.apk`; SHA256 `b181b5f612b1925df583aabf214fbe44046cfbf3a39564482c8640a12d64e3d4`.
- Private phone pairing instructions saved at `artifacts/supabase-cutover/phone-connection.txt` (ignored; contains only the URL and device pairing token).
- Worker Vault credential configured. Publication audit found no local credential matches in publishable files.

Pending:

- Automatic approval review rejected one real Gemini generation probe and recurring one-minute worker activation because their quota/generation side effects require explicit authorization. Neither was executed. The worker schedule is OFF, so uncached generation jobs will remain queued until activation is authorized.
- No Android device was attached. APK installation, cloud Settings configuration, physical-device mobile-data/laptop-off refill, and offline/favorites checks remain unverified.
- Source retrieval and live Gemini generation have not been accepted on the hosted runtime; mocked tests do not establish upstream availability or accuracy.

Keep the local generation worker stopped after cutover. Reconcile cloud usage and job/delivery state before any return to local generation, to avoid splitting the daily budget ledger.
