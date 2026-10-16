# JigyaByte Supabase migration

2026-10-14 update: apply `migrations/20261014000100_model_cooldowns.sql` before deploying the updated functions. It adds a private persistent model cooldown table without rewriting content or usage. The compact `/v1/connection` route supports the app's five-minute handshake and daily usage pill; sync responses include friendly request feedback. `schedule-worker.sql` now dispatches only when a queued job is due or a running lease has expired, so idle minutes do not invoke an Edge Function. Reviewed activation for the updated refill flow supersedes the initial-deployment pending-job guard. See the deployment evidence for actual rollout status.

Project: `fuomvvzgdhleikztdpgz`.
Phone backend URL: `https://fuomvvzgdhleikztdpgz.supabase.co/functions/v1/jigyabyte-api`.

The cloud backend uses private Postgres tables and two Edge Functions. The phone continues to own its offline SQLite library. The API preserves protocol 1 and ten-card delivery/ack semantics. The worker processes one job and at most one Gemini attempt per invocation. A one-minute cron wakes the worker; retries retain their route and due time. Global transactional locks serialize mutations and budget reservations. A 180-second claim lease fences stale invocations. Expired running jobs become uncertain for explicit Retry, with reservations preserved.

## Deployment sequence

1. Authenticate locally: `npx supabase login`. Keep account credentials out of chat and source control.
2. Link: `npx supabase link --project-ref fuomvvzgdhleikztdpgz`. Enter the database password privately at the prompt.
3. Review/apply the schema. The current deployment used `npx supabase db query --linked --project-ref fuomvvzgdhleikztdpgz --file supabase/migrations/20261013000100_backend.sql` through the Management API. This applies the transactional SQL directly; it does not populate the CLI migration history. Do not blindly run `db push` on this already provisioned project. For future migrations, reconcile CLI migration history first or continue with explicitly reviewed SQL files.
4. Configure secrets from `cloud-config.example`. The deployed functions use the injected `SUPABASE_DB_URL`; no database password needs to be pasted in chat. An optional `JIGYABYTE_DATABASE_URL` overrides it with a Transaction pooler URI from Connect. Use separate random device/worker tokens. `node scripts/prepare-supabase-secrets.mjs` copies only approved provider settings into ignored `.env.cloud` and generates those tokens. Upload with `npx supabase secrets set --env-file .env.cloud --project-ref fuomvvzgdhleikztdpgz`. Never upload the PC `.env` wholesale.
5. Deploy: `npx supabase functions deploy jigyabyte-api --project-ref fuomvvzgdhleikztdpgz --use-api`, and likewise `jigyabyte-worker`. Custom bearer authentication runs inside each function; platform JWT verification is disabled intentionally. No admin/database/Gemini credential belongs in the APK.
6. Stop the local Node backend. Wait for active Gemini requests to finish. Run `node scripts/export-supabase-data.mjs`. This verifies that the configured local endpoint is stopped, takes a consistent SQLite backup and exports all backend rows including daily usage. Stale running jobs become uncertain in the exported copy without modifying the original database or refunding reservations. Keep the generated files private in ignored `artifacts/supabase-cutover/`. Import `import.sql` through Management API SQL, a private Postgres connection, or Dashboard SQL editor. The import is transactional and refuses an already activated/populated target. It unlocks cloud sync/generation only after successful transfer. If the local backend runs again before the import, export again.
7. Check authenticated status, usage totals and delivery/job counts before installing the new APK. `/health` reports `ready:false` until the transfer completes. Test cached deliveries first; perform deliberate live Gemini generation within the existing caps only after cutover.
8. Add a Vault secret named `jigyabyte_worker_token` matching `JIGYABYTE_WORKER_TOKEN`. Review/run `schedule-worker.sql` only after explicit authorization for recurring Gemini generation. It refuses initial activation while any queued/running job exists. This is separate from migrations so the schedule cannot be activated accidentally before secrets/data are ready. At one invocation/minute, the schedule alone uses about 43,200 calls in a 30-day month; app API traffic is additional. Current schedule activation remains pending approval.
9. Build/install the updated APK, enter the full function URL and the device pairing token in Settings > Topics, and enable refill. Saved LAN settings are preserved; defaults remain disabled until deliberately configured.
10. Test with the laptop shut down and the phone on mobile data. Confirm cached delivery, generated refill toward 60, explicit Retry, retained favorites, and offline reading. Build checks and fixture tests do not establish hosted/device acceptance.

## Checks

`npm run typecheck`, `npm run backend:typecheck`, `npm run backend:test`, `npm test`.

Cloud runtime check: `npx deno check --config supabase/functions/deno.json supabase/functions/jigyabyte-api/index.ts supabase/functions/jigyabyte-worker/index.ts`.

Hosted cached-delivery/authentication probe: `node scripts/test-supabase-hosted.mjs`, followed by applying the generated private `artifacts/supabase-cutover/probe-cleanup.sql`. This does not make a Gemini request. `--generate` is a separate real-provider probe requiring explicit authorization; it makes at most one provider attempt and preserves the reservation. Cleanup deletes only the test device state, retaining generated cache and usage.

Cloud regression tests use a separate disposable local Postgres database with `anon` and `authenticated` roles, plus the migration above. Set `JIGYABYTE_TEST_DATABASE_URL` to that local database and run `npx deno test --allow-env --allow-net=127.0.0.1 --config supabase/functions/deno.json supabase/tests/cloud.test.ts`. Never point these tests at the hosted project; they reset test tables.

## Recovery and limits

Stop scheduled execution with `select cron.unschedule(jobid) from cron.job where jobname='jigyabyte-worker';`. Keep the laptop worker stopped after cutover. Before returning to local generation, reconcile the cloud usage ledger and pending jobs/deliveries into local storage; starting an old local database would split budgets. Offline reading is available while resolving backend problems.

Private tables have RLS enabled and no anonymous/authenticated grants or policies. Edge functions connect privately using the database URI. All protocol mutations use parameterized SQL. Public health output contains no user state. Worker credentials are separate from phone credentials. Error responses omit secrets and raw upstream/database errors.

Free hosting has quotas and possible inactivity pausing; it does not guarantee permanent availability. Preserve `ALLOW_PAID_CALLS=false`. No paid resource or extra generation provider is enabled. Supabase's function wall-clock and CPU limits still require hosted verification with the actual source-fetch/generation workload.
