# JigyaByte phone acceptance

## Free live sources and randomized batch generation — 2026-10-12

The backend now uses free public source adapters, dated references and output-sized batches. Both typechecks, app/data/HTTP integration tests, all 39 backend tests, publication audit and ARM64 APK build passed. The source-only probe retrieved 41 usable items: 33 current-affairs, seven AI/coding and one game announcement; GDELT timed out from this machine. No Gemini requests or usage changes were made. The updated APK is `artifacts/JigyaByte.apk`, SHA-256 `d44a656c2e1f350476482dbd37fd48afa402a30ece67b41cd6a2ecf188837246`. Build and fixture checks do not establish physical-device or live Gemini acceptance. Backend service remains user-started.

- [ ] Install the updated APK; existing cards, favorites, interests and analytics survive.
- [ ] Open sourced card details: source name, title, Published/Indexed date and retrieval date display; tapping opens the correct HTTPS article.
- [ ] Disable the backend and restart the phone: saved card bodies and source metadata remain readable offline.
- [ ] A small connected refill uses cached cards before generation; a new output-sized batch is generated only after cache exhaustion, then surplus feeds later refills.
- [ ] Across several batches, generation spreads across available topics in random order without extra generation weight for selected interests. Feed review/interest lanes still work.
- [ ] Disconnect public sources: news without fresh context is skipped and evergreen generation remains available.
- [ ] Inspect authenticated status: daily caps, effective batch count and source failures are visible. Failures/retries never clear usage reservations.


## Feed favorite burst — 2026-10-12

New favorites emit ten small lime hearts, sparkles and dots plus a soft ring from the feed heart button, alongside its existing spring pulse. One native-driven progress value runs for 620ms; particle views exist only during the burst, ignore touches and are hidden from accessibility. Existing favorites do not celebrate on mount or return to Feed. Reduced motion disables the burst.

Validation: app TypeScript, existing feed gesture regression checks, Git whitespace checks and the ARM64 release build passed. APK SHA-256: `ca583a6a7c803d6a1e91cf063e5b86506068ff40f3650e955d7628fcdc0c8a78`. No Android device was connected; animation appearance and frame timing remain pending phone review.

- [ ] Tap an unsaved card's heart: confirm a short burst originates at the heart without changing feed position or covering navigation.
- [ ] Double tap the card copy to favorite it: confirm the same burst at the heart button.
- [ ] Remove a favorite, return to an existing favorite, and switch tabs: confirm no celebration for those actions.
- [ ] Quickly favorite/unfavorite and swipe while the burst runs: confirm taps and paging remain responsive, with no lingering particles.
- [ ] Enable Android reduced motion: confirm favorites still save with no burst or heart pulse.

## Settings and connection panel — 2026-10-12

Settings is the fourth navigation tab. Topics opens from Settings and returns there after saving or cancelling; the first-launch topic flow still leads to Feed. Analytics no longer contains the backend panel. Settings keeps an 88dp connection panel above navigation, outside its scrolling content, with a glowing green/red dot, last successful connection time, local unread count and circular two-arrow refresh icon. Pills stay single-line in fixed-height containers. Refresh retains the previous explicit failed/uncertain-job recovery behavior.

Validation: TypeScript, feed gesture/data tests, fixture HTTP integration (including connection color stability, failed-check timestamp preservation and reconnection), Git whitespace checks and ARM64 release build passed. Integration used no live model calls. APK SHA-256: `ffc8d2c94630ef4ff6d317fd5bf2c4d48d3077b76e8808afa50efbc07503e131`. No Android device was connected for installation or visual acceptance; the checklist below remains pending.

- [ ] Verify navigation order: Feed, Favorites, Analytics, Settings. Topics is absent from the Feed header.
- [ ] Open Settings → Topics, save changes or cancel, and verify return to Settings. Confirm Feed position is preserved across navigation.
- [ ] With a paired backend, confirm the dot stays green during checks every five seconds. Stop the backend: it turns red after a failed check and keeps the last successful time. Restart: it turns green after the next successful check.
- [ ] Confirm the unread pill matches local unread card bodies after reading, importing and going offline, including with automatic refill disabled.
- [ ] Verify the panel stays at the bottom above navigation and keeps its size through timestamp, count and connection changes. Check large Android text and a narrow display.
- [ ] Verify the refreshed two-arrow icon is clear and its button retries/refills as before.

## Current Gemini-only card flow — 2026-10-11

The old Wikipedia discovery and local Ollama generator have been removed. New cards are generated only by Gemini through the PC backend, with a curiosity-first prompt and an explicit unverified label. Backend schema 6 invalidates its previous card cache and drops cached source excerpts; app schema 7 removes the retired local-generator preference. The backend remains stopped at the user's request. No live Gemini call or phone acceptance was performed for this change.

Use the checklist below after the user starts the backend and pairs the phone. Confirm cards read like memorable facts, surprising connections, reflective ideas or useful game/software development tips; confirm non-professional topics avoid heavy jargon and academic prose. Verify the UI says Gemini-generated and unverified. Test retrying a failed 3.8 request and the configured 3.6 fallback, then stop the backend and confirm saved cards remain readable offline.

The dated records below describe earlier app versions and provider experiments. They are historical evidence only; their Wikipedia, local-model and source-grounded behavior is no longer part of the app.

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
- [ ] With Gemini backend paired, create fresh cards in several topics. Check the requested fun-fact tone, plain language outside game/software development, and the Gemini-generated/unverified label. Stop the backend, switch to airplane mode, force-stop/reopen and read saved cards.
- [ ] Try creating a card while the backend is offline. Confirm a useful status and that all existing cards remain available.
- [ ] Inspect long titles/text at normal and enlarged Android text sizes. The feed previews truncate; More contains the full text. Confirm all controls remain reachable and details scroll. There are no image dependencies in the core feed.
- [ ] Use TalkBack: More, favorite, back, metric tabs, topic choices, backend controls and chart rows have clear labels/states. Check paging with Android reduced motion enabled.

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


## Sensitive Feed paging — 2026-10-12

Feed vertical paging now has a single owner: the app responder. Native touch scrolling and page snapping are disabled; programmatic scrolling follows the drag and settles to one adjacent page. Upward/downward movement of 3 layout units commits a page, independent of speed and screen height. Taps and smaller jitter stay put. A downward pull of 64 units on the first page refreshes; imports still append without changing the current page. Returning from details restores the committed page, including when details were opened during a settle.

Validation: TypeScript and the Feed gesture regression checks passed; data regression checks passed. The broader backend integration fixture failed at scripts/test-backend-integration.cjs:65, expecting one delivery-outbox record but receiving zero. That fixture does not exercise Feed gestures. Release APK built successfully at artifacts/JigyaByte.apk, SHA-256 abed81b7f01d86b3f5232d227af99d8d714e4ae7bff7e61a34b4416558c58f94. No ADB device was connected; installation and physical gesture acceptance remain pending.

- [ ] Short, slow upward swipe from title, summary, footer and favorite control advances exactly one card without snapping back.
- [ ] Long upward swipe and repeated quick swipes each advance one page; no skipped cards or partial resting positions.
- [ ] Short downward swipe returns one card; first-page downward pull refreshes once and retains the current card.
- [ ] Tap/double-tap/favorite and left-swipe details still work; returning restores the same page.
- [ ] Last card advances to the end page; swiping there stays bounded; downward swipe returns.
- [ ] Repeat with reduced motion and Android system-back gestures.
