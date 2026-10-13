# Deployment evidence, 2026-10-13

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
