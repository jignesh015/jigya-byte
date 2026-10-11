# JigyaByte phone acceptance

## Exact provider error investigation — 2026-10-11

Two one-request probes, with and without explicit low thinking, returned HTTP `503`, Google status `UNAVAILABLE`, and `This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.` This is exact current capacity-error evidence; older response bodies were discarded by the previous adapter. The latest prior phone job also recorded `provider_refused_or_incomplete`, but its historical finish reason is unknown.

Backend SQLite version 3 retains sanitized provider diagnostics. No prompt/output/thought text or API keys are stored. Gemini 3.8 now explicitly uses low thinking locally; output/request/token budgets remain unchanged. Retry delays increased to roughly 10/20 seconds plus jitter, retaining the maximum three attempts. Twenty backend tests, backend TypeScript checks and real fixture Android integration pass. The server was restarted with these changes; no APK update is required for this backend-only investigation.

The twelve daily request reservations are exhausted after the two controlled probes. Live recovery remains blocked by provider overload and the configured daily cap. Cached cards remain usable; no paid activation, automatic model switching or budget reset was performed.

## Retry recovery diagnosis — 2026-10-11

Latest installed release SHA-256: `e3cb030431d255a7c2383dc1984479b459004ead367f351a57a5fcf9c541131f`. Gemini key isolation check passed against the built bundle.

The backend was reachable and reporting 12 unread / 13 read non-favorites. Its final generation job was `uncertain` after `upstream_timeout_or_network`. The old Android Retry handler searched only failed jobs, so this job was silently skipped.

Explicit Retry now includes uncertain jobs only when backend status allows confirmed free Gemini with paid calls disabled. The server accepts that recovery, retains the original reservation and reserves each new attempt. Running/queued jobs cannot be queued again; uncertain paid calls remain blocked. Timeout increased locally from 30 to 60 seconds; no request/token/cost limits were raised.

On the updated Samsung, Analytics showed the specific timeout explanation. Pressing Retry changed the banner to “Preparing more cards…” and started a real backend request. Gemini then returned upstream server failures through all three bounded attempts; the job ended `failed` / `upstream_unavailable`, with no new cards. Inventory remains 12 unread, cache 25. Reservations total nine requests / 217,728 tokens / zero configured monetary cost. This proves the button dispatch works, not that live supply recovered. The UI now explains provider server failures and asks to retry later.

Nineteen backend tests and Android fixture HTTP integration pass, including actual client dispatch of uncertain recovery, paid-mode refusal, unchanged prior reservations and duplicate-click rejection. Both TypeScript checks pass. Provider availability remains an external limitation; no automatic switching or billing activation was performed.

## Feed refresh and motion — 2026-10-11

Latest installed APK SHA-256: `8157197346db0c8f5cc54df9fefdda308942c5b4e6c0028872540e761176dd39`. Backend status/unread/provider and Retry now live on Analytics. Feed has native pull to refresh at the top of its paged deck; it awaits a coalesced sync pass, appends imported cards and finishes on offline failure or foreground cancellation. Without configured backend pairing, it uses the explicit public-discovery path. Refresh does not override an uncertain upstream job or reset budgets.

Heart changes compress briefly then spring back with a pulse; reader entry slides 48dp and fades over 240ms using native-driven transforms/opacity. Reduced motion disables both. Android device checks confirmed no Retry/status bar on Feed, the same game-design card after pulling down, status/Retry on Analytics, and swipe-left opening the matching reader. Heart selection rendered filled and was cleared after the temporary test. Screenshot: `artifacts/feed-pull-refresh-phone.png`. These checks establish navigation and final visual states; animation feel/frame timing and reduced-motion device acceptance remain for user review.

TypeScript checks and root regression checks pass. The fixture HTTP test covers awaited refresh, queue preservation, offline completion with the actual cached unread count, and cancelling a refresh when backgrounded. No new live Gemini calls were made for these changes.

## Sample removal and SVG heart — 2026-10-11

Latest installed APK SHA-256: `f66282e0377f6f6dfa661930598078e79bf5c9e2e48b3112dafab9194a576aaf`. Schema version 5 removes all original starter cards, including their sample favorites, reviews and local interaction counts; preserves imported provider cards and secure pairing; starts empty on a clean installation. Starter content moved out of the application entirely; tests use isolated fixtures under `scripts/fixtures/`. Imports reject the retired sample provider.

The Samsung reopened successfully after the in-place update. Its synchronized inventory reports zero retained sample references, 24 unread real cards and one read real card. The feed displays “Understanding the Scientific Discipline”; its reader shows “AI prepared from fetched sources · gemini / gemini-3.8-flash” and Wikipedia attribution. The custom SVG heart rendered on the feed, reader and Favorites tab. Tapping it saved the real card to Favorites; reader navigation and removing the temporary favorite succeeded. Screenshot: `artifacts/actual-cards-svg-heart-phone.png`.

Backend generation now requests up to ten distinct cards in one structured response, with a smaller final batch for the remaining deficit. Compact source excerpts and concise explanations keep prompts bounded; existing request/token/cost limits remain unchanged. Mock tests prove one call reserves one request for ten cards, and a changed deficit shrinks a queued batch to three. The prior uncertain live request remains blocked; no new live model calls were made to test the larger batch. Root tests, eighteen backend tests and both TypeScript checks pass. The release bundle contains neither the Gemini key nor original sample bodies/labels.

**Status: PASSED FOR NOW — user acceptance recorded 2026-10-10.** The user explicitly requested that the manual gate be marked passed. This records the overall acceptance decision, not a new agent-run verification of every step below.

**Open exception:** Wikipedia discovery returns HTTP 403 on the phone. The successful-import step is blocked and the provider is not declared fixed. Real-model local AI testing remains optional/unverified. The checklist below is retained as a repeatable test reference for future builds; its unchecked items are not blockers to the user's accepted gate.

Target phone: Samsung SM-S901E, Android 16, APK 1.0.0. Record text-size settings when repeating visual checks. Phases 9–11 need their own new acceptance tests after implementation.

- [ ] Install the personal APK, stop Metro/PC service, and open JigyaByte. Confirm icon/name and dark system bars with safe top/bottom spacing.
- [ ] Choose interests or skip onboarding. Confirm Feed and Analytics remain one tap apart.
- [ ] Swipe up: one full-height card per page. Swipe left from the title, summary and footer, away from the outer 32px system-back edges. Confirm vertical swipes do not open details.
- [ ] Tap More. Use Back to feed, then repeat using Android system back. Confirm the exact card/page and favorite state are preserved.
- [ ] Open the same card repeatedly. Seen and Expanded increase once each. Switch chart metrics: all ten categories remain readable, including zeros. Totals count primary topics without overlap.
- [ ] Save one card; Favorites and its category increase by one. Remove it and confirm both decrease immediately. Repeat after force-stop/reopen.
- [ ] Schedule Again, Got it and Easy on different cards; confirm their displayed due dates are roughly 10 minutes, 1 day and 7 days later. After Again is due, restart and look for a review lane (recent-card exclusions can postpone selection until the unseen pool is exhausted).
- [ ] **KNOWN ISSUE — HTTP 403:** With network enabled, use Find a new card. Once repaired, read source attribution and license in details. Switch to airplane mode, force-stop/reopen and read the imported card locally.
- [ ] Try discovery while offline. Confirm a useful error with all existing cards still available. Turn the PC service off and repeat startup.
- [ ] Inspect long titles/text at normal and enlarged Android text sizes. The feed previews truncate; More contains the full text. Confirm all controls remain reachable and details scroll. There are no image dependencies in the core feed.
- [ ] Use TalkBack: More, favorite, back, metric tabs, topic choices, AI toggle and chart rows have clear labels/states. Check paging with Android reduced motion enabled; there are no custom transition animations.
- [ ] Optional: run the local service with a real installed Ollama model, enable local AI, generate one card, and verify its unverified label and offline persistence. Disable/stop the service and confirm public discovery still works. A real-model test has not been automated.

For a clean zero-data chart test, deliberately clear storage first only if no data needs preserving. Skip onboarding and open Analytics; Expanded and Favorites should display guidance and ten zero categories. Seen can already be one because the first feed card was viewed.

## Android backend integration evidence — 2026-10-11

Release rebuilt after the final application edits, installed with `adb install -r` on Samsung SM-S901E / Android 16, preserving user data. Artifact: `artifacts/JigyaByte.apk`, SHA-256 `ec7faca449c1422f05cb0e2028ce571cb2d5023607d5b361e01153079cba64dd`. The release bundle was checked against the actual private Gemini key without printing it; the key was absent.

- Phone configured with USB forwarding on port 4319, automatic refill enabled, and backend pairing token held in SecureStore. Gemini credentials remain only in the ignored PC environment file.
- Real source-grounded Gemini preparation produced 25 cached cards; phone acknowledgments reported 26 committed unread cards, nine read non-favorites, no favorites and no pending delivery. This count is from the phone's inventory, not a projected cache count.
- Five generation requests completed. The sixth timed out with `upstream_timeout_or_network` and remained `uncertain`; the backend stopped without redispatch. Reservations: six requests, 145,152 tokens, zero configured monetary cost. Live refill did not reach 50/60; this shortage remains visible. Provider usage/billing was not independently audited.
- On the phone, temporarily saved the current inertia card, opened Favorites and its reader, verified the return-to-Favorites route, removed the temporary favorite and returned to the same feed card. No data reset was performed. Screenshot: `artifacts/backend-integration-phone.png`.
- USB connection was restored after a disconnected restart attempt. The phone had relocked, so offline restart and secure-setting persistence were not visually accepted during that attempt.

Automated evidence is separate: version-3 migration preserves interests/favorites/reviews/history; 40 favorites and the 30 read-non-favorite cap survive cleanup/restart; evicted identities do not resurrect; active unfavorite remains safe. Real fixture HTTP integration demonstrates 10-to-60 committed refill, concurrent reading, lost-ack recovery, stable queue append and offline preservation. All root tests, seventeen backend tests and both TypeScript checks pass. Automated tests make no live provider calls.

- [ ] Repeat full offline restart and SecureStore reconnection acceptance on the unlocked phone.
- [ ] On the phone, verify 31+ reads, 40+ favorites, scheduled review eviction, active-reader cleanup and enlarged text/TalkBack.
- [ ] Exercise phone/backend crashes during import, acknowledgment and generation; reconcile uncertain upstream requests before authorizing replacement generation.
- [ ] Reach at least 50 committed unread cards with live supply and verify proactive refill from 55 toward 60.
- [ ] Diagnose the original direct-phone Wikipedia 403 separately. Backend Wikipedia success does not repair that path.
# Free Gemini fallback validation (2026-10-11)

- Configured Gemini 3.8 Flash → Gemini 3.6 Flash after the user's explicit fallback request. The user subsequently chose to keep OpenAI disabled after learning that API-key usage is separate from ChatGPT Plus. Its key remains private and its quickstart model is configured without activation.
- Google's read-only `models/gemini-3.6-flash` endpoint returned HTTP 200 with `generateContent` supported for the configured key. This verifies model metadata access, not successful card generation.
- Backend restarted successfully on 127.0.0.1:4319; authenticated `/v1/status` returned HTTP 200 with exactly the two Gemini routes and `openaiFallbackEnabled=false`. SQLite schema migrated from version 3 to 4, preserving existing content/jobs/usage.
- 26 backend tests passed, covering actual fallback order, shared budgets, restart persistence, successful model attribution, terminal credential/refusal/output errors, ambiguous timeouts, and denial of uncertain OpenAI retries. Backend TypeScript check and Android/backend integration fixture passed. No live generation calls or OpenAI charges occurred.
- Current live reservations remain 12 requests / 290,304 tokens / zero reserved monetary cost. Live fallback generation and new-card delivery remain unverified until the existing UTC daily request limit resets. Do not reset reservations to bypass this limit. No Android APK change was needed for server-side routing.

