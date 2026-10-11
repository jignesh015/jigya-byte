# JigyaByte Development Plan

This checklist breaks the MVP into independently reviewable phases. Complete and review a phase before moving on; if a requirement changes, update this plan and `agent.md` first.

**Manual gate, 2026-10-10:** Passed for now at the user's request. Wikipedia discovery throws HTTP 403 and remains an open issue; no successful Wikipedia import or real-model AI test is inferred. Earlier implementation-time validation notes below are historical. New work is planned in Phases 9–11 and `backend-plan.md`; this update changes documentation only.

## MVP outcome

An installable, dark-only Android app named **JigyaByte** that works from local storage, presents a full-height, vertically paged learning feed, opens deeper card details with a left swipe or visible control, supports saved cards and due reviews, and shows category analytics. It can obtain content from a free public provider. AI generation and a PC-hosted service are optional additions, not prerequisites for using cached content.

## Phase 0 — Lock implementation decisions — Ready

- [x] Inspect the current project and confirm the Android implementation stack (native Kotlin, React Native/Expo, or another choice).
- [x] Choose the local database and migration approach.
- [x] Decide whether the PC service is optional or required for fetching new content. Keep local reading and interaction history independent either way.
- [x] Choose the first public content provider and review its rate limits, content license, attribution requirements, and suitability for the ten topics.
- [x] Decide how card categories are represented, including the primary category used in analytics when a card has multiple topic tags.
- [x] Confirm the initial review actions and scheduling intervals.
- [x] Confirm whether the feed has optional session progress or simply scrolls continuously.
- [x] Record choices and meaningful tradeoffs in `agent.md` before implementation.

**Exit criteria:** the implementation stack, persistence plan, first content source, and unresolved product choices needed by the first build are written down. No paid service or billable resource is enabled.

## Phase 1 — Android app shell and visual foundation — Ready

- [x] Create or configure the Android app project and set the display name to **JigyaByte**.
- [x] Establish the dark-only visual tokens: background, raised surface, text, muted text, borders, and accent color.
- [x] Apply the system status/navigation bar treatment and account for display cutouts and safe insets.
- [x] Create the main Feed and Analytics destinations with a persistent bottom bar and an unmistakable selected state.
- [x] Add placeholder content to each screen so navigation can be reviewed before data work.
- [x] Keep the expanded-card route separate from the two-tab main navigation.

**Exit criteria:** the app launches on Android, remains dark-only, and Feed and Analytics are reachable from either main screen.

## Phase 2 — Local data model and sample content — Ready

- [x] Define database tables/models for topics, cards, sources, card-topic links, interaction events, favorites, review state, and user preferences.
- [x] Store source/provider identifiers, URLs, attribution, license, retrieval time, and a stable content hash with imported cards.
- [x] Add versioned database migrations and repository/data-access boundaries.
- [x] Seed the ten preferred topics: Game Design, Science, History, Geography, Space, Economics, Psychology, Technology, Philosophy, and Biology.
- [x] Add a small set of clearly labeled sample cards for UI development; keep sample data distinct from provider content.
- [x] Persist seen, expanded, favorite, and review actions locally and make imports idempotent.

**Exit criteria:** sample cards and user actions survive closing and reopening the app; re-importing the same card does not create a duplicate.

Phase 2 implementation is ready for manual Expo review. Persistence behavior is implemented in SQLite but has not been exercised on a device in this work session.

## Phase 3 — Full-screen feed paging and expanded-card flow — Ready

- [x] Render one full-height learning card per feed page; swipe up to advance without requiring a “Got it” tap.
- [x] Give each card a title, concise explanation, topic, source attribution, and favorite control.
- [x] Implement leftward horizontal swipe anywhere on the Feed screen to open the currently displayed card's expanded view; avoid the Android system-back edge zones.
- [x] Add a visible, accessible “More” affordance as an alternative to the swipe.
- [x] Implement a clear back arrow and “Back to feed” label on the expanded view.
- [x] Route Android's system back button from expanded details back to the feed.
- [x] Preserve the exact feed position and card state when returning from details.
- [x] Resolve gesture competition so vertical movement pages up and horizontal movement opens details.
- [x] Keep the detail view focused on reading and omit the main bottom bar there.
- [x] Record a card as seen once when it meaningfully enters view, rather than once per render or revisit.

**Exit criteria:** the user can swipe up through full-height cards, open details with a left swipe anywhere on the feed or by tap, return using the visible control or Android system back, and favorite/unfavorite a card without losing state.

**Status:** Ready for manual Expo Go review. Full-height paging, screen-wide swipe arbitration, scroll restoration, and Android system back still need device interaction review.

## Phase 4 — Preferences, feed composition, and reviews — Ready

- [x] Add an onboarding/settings step for selecting personal-interest topics from the supported topic list.
- [x] Implement the target 70/20/10 mix using a shuffled ten-slot schedule: seven discovery, two interest, one due review.
- [x] Exclude recently shown cards and duplicate/near-duplicate content where identifiers or hashes allow.
- [x] Rotate interest topics to avoid repeatedly selecting one topic when others have eligible cards.
- [x] Use discovery as a fallback when an interest or due-review lane has no eligible card, and retain the actual source lane in interaction history.
- [x] Create review actions and deterministic initial due-date rules selected in Phase 0.
- [x] Ensure cards can be favorited and reviewed independently; a favorite is not automatically a review card unless the user chooses that behavior.

**Exit criteria:** with enough eligible cards, the feed follows the target proportions over a ten-card block; with an empty lane, it continues without a blank card and records the fallback.

**Status:** Ready for manual Expo Go review. Sample content has ten unique cards; empty review lanes are filled from discovery until review dates become due.

## Phase 5 — Free public content mode — Ready

- [x] Implement the selected provider behind a `DiscoveryProvider` interface.
- [x] Normalize provider responses into the app's learning-card model, keeping provider-specific code out of screens.
- [x] Keep card text concise and attach the original source and required attribution/license details.
- [x] Add request timeouts, bounded retries, caching, duplicate detection, and respectful rate limiting.
- [x] Show clear loading, empty, offline, and provider-error states while keeping cached cards readable.
- [x] Keep provider access read-only unless a separate feature explicitly requires otherwise.

**Exit criteria:** new public-source cards can be fetched, attributed, cached locally, and read after disconnecting from the network. Provider failure does not block the app or erase local content.

**Status:** Manual gate accepted with a known exception: the user reports Wikipedia HTTP 403 on the phone. Diagnose the exact failing endpoint/request in backend Phase B2; do not call this provider fixed or usable until a real import succeeds. Existing locally stored cards remain the fallback.

## Phase 6 — Analytics screen — Manual gate accepted by user

- [x] Implement the Analytics destination and the persistent Feed/Analytics bottom navigation.
- [x] Show summary counts for Seen, Expanded, and Favorites.
- [x] Add a selector that switches a readable category bar chart between Seen, Expanded, and Favorites.
- [x] Include all ten topic categories and useful zero-data/empty states.
- [x] Default to an all-time view; add date-range filtering only if it remains clear and useful.
- [x] Use unique-card counts for Seen and Expanded; use currently saved cards for Favorites.
- [x] Apply the primary-category or overlap rule chosen in Phase 0 and label the chart accordingly.
- [x] Ensure removing a favorite updates the favorites chart and summary.

**Exit criteria:** counts match the local interaction/favorite data and remain consistent after app restart; both main destinations remain one tap apart.

**Validation:** TypeScript passes. `node scripts/test-data.cjs` exercises the actual repository SQL against desktop SQLite, including repeat events, secondary tags, and favorite removal. The manual gate was subsequently accepted by the user on 2026-10-10; this is separate from those automated checks.

## Phase 7 — Optional AI mode and PC service — Ready for real-model review

Do this only after the free-source path is useful. Keep this phase out of the MVP critical path if it adds setup or maintenance cost.

- [x] Decide whether AI generation runs through a local PC service or another explicitly approved route.
- [x] Add a separate `CardGenerator` interface; keep generation and factual-source retrieval as distinct provider responsibilities.
- [x] Keep API keys out of the Android package and source control.
- [x] Make AI mode opt-in and clearly label generated explanations and any supporting references.
- [x] Add an explicit zero-cost guard: no paid API calls, billing setup, or quota overages without direct user approval.
- [x] If a PC service is used, define health/status and content endpoints, cache results, and make service absence non-fatal.
- [x] Handle model/provider errors by returning to cached cards or the public-source mode without losing user state.

**Exit criteria:** AI mode is clearly separated from public-source mode, secrets are not shipped in the app, and the app remains fully usable when the AI provider or PC service is unavailable.

**Validation:** Local service integration tests pass with a stub model: generation, invalid input, duplicate caching, cache reload, cloud-name refusal and unavailable model. The real Ollama model and phone-to-PC connection remain optional manual checks; no model has been downloaded or paid service enabled.

## Phase 8 — Polish and personal APK handoff — Manual gate passed for now

- [x] Refine typography, spacing, card height, chart readability, and touch targets on the target phone.
- [x] Tune scroll and detail transitions to feel responsive; respect Android accessibility and reduced-motion settings where available.
- [x] Check long titles, long text, missing images, empty categories, offline startup, and provider errors.
- [x] Confirm app name/icon, package identity, permissions, and local data behavior.
- [x] Build a locally installable APK and install it on the intended Android device.
- [x] Confirm the installed app opens, navigates, persists data, and can be used without the PC service.
- [x] Document how to rebuild the APK, configure any local provider, and back up or reset local data.

**Exit criteria:** the personal APK is installed and the core feed, expanded view, favorites, reviews, and analytics work on the user's device. Do not treat a successful build alone as device acceptance.

**Handoff evidence (2026-10-10):** ARM64 release build succeeds; `artifacts/JigyaByte.apk` is 28,109,440 bytes. SHA256: `9336d771af616cb9080f9ccc99df08d228bddce92df566009374f658a911574c`. Installed successfully on the connected Samsung SM-S901E, Android 16, main user profile. Launched without Metro or a PC service, initialized SQLite, and rendered topic onboarding; app process logs show no startup ReactNativeJS/AndroidRuntime errors. `artifacts/startup.png` records the on-device screen. TypeScript and final data/service tests pass. Generated release manifest confirms package identity, API 24 minimum / API 36 target, and no microphone/storage/overlay permissions. The build retains Expo's normal vibration permission and enables HTTP for the optional local PC service.

Feed previews cap long titles/summaries, chart rows expose spoken counts, key controls have 48dp targets, and feed layout ignores zero-height callbacks while hidden to preserve return position. No custom animated transition is introduced. The image reference informs the charcoal/ivory/lime palette and analytics layout; the current MVP remains text-focused, without the reference's decorative space imagery or session counter. The user accepted the manual gate on 2026-10-10 and requested it be marked passed for now. Phase 8 checks reflect that acceptance decision, not additional agent-run checks. Wikipedia HTTP 403 remains open; optional real-model AI testing remains unverified.

## Phase 9 — Favorites library — Implemented; extended device acceptance pending

- [x] Add a persistent **Favorites** destination between Feed and Analytics; keep all three destinations one tap apart with accessible selected states.
- [x] Load currently favorited cards from local SQLite, newest saved first, with title, primary topic and a short preview.
- [x] Open the existing expanded reader from Favorites; visible back and Android system back return to the library and preserve its scroll position. Feed returns still preserve the exact feed page.
- [x] Show a useful empty library state with a route back to Feed. Reading the library and its details must work offline.
- [x] Unfavorite in either the library, feed or details and update every screen plus Analytics immediately.
- [x] Preserve existing favorite bodies through migration and cleanup; favorites have no automatic deletion limit and are excluded from the 30-read-card cap.
- [x] Mark a never-seen favorite read on its first meaningful reading view. Viewing an existing favorite must not increment unique counts again or advance the feed queue.
- [x] Handle removing an actively open favorite safely; keep its body available until leaving details, then apply retention without a blank reader.

**Exit criteria:** all favorites are accessible offline and remain readable after more than 30 other cards are read. Unfavorite updates the library/counts and makes read content eligible for cleanup. Returning from both reader entry points restores the correct origin.

## Phase 10 — Persistent queue and local retention — Implemented; extended device acceptance pending

- [x] Migrate version-3 SQLite data to persisted read/unread state and a queue with stable ordering. Backfill read state from existing Seen events and preserve interests, favorites and review dates.
- [x] Define read as the first meaningful Seen impression; paging/review does not require an extra completion button. Keep first-read time immutable on revisits.
- [x] Replace the current finite in-memory ten-card session with persisted queued assignments built in shuffled 70/20/10 blocks. Reserve unread cards for discovery/interests and retained eligible cards for reviews, recording actual fallback lanes.
- [x] Keep the active card and scroll position stable while appending refill results; neither reconnect nor changing providers may reshuffle the active queue.
- [x] Cap retained read, non-favorite bodies at 30. In a transaction, evict the oldest eligible bodies after reading, unfavoriting and startup cleanup; preserve every unread body and every favorite.
- [x] Migrate analytics/dedup history away from cascading deletion of payload rows. Keep compact IDs/hashes, unique Seen/Expanded flags, primary-topic snapshots and timestamps for evicted cards.
- [x] Remove evicted non-favorite bodies from local review eligibility; retain historical review actions. Reviews on retained/favorite cards keep the Phase 0 intervals.
- [x] Prevent eviction of the active reader/page until safe; delete other oldest eligible read bodies first and rerun cleanup on leaving the protected view.
- [x] Prevent sample seeding from recreating previously evicted read samples on every startup.
- [x] Expose authoritative unread/read-non-favorite/favorite counts and retained IDs/hashes to synchronization. Favorite overlap must not double-count unread or retained totals.

**Exit criteria:** after reading 31 non-favorites, only 30 read non-favorite bodies remain. Favorites and unread content are untouched. All-time Seen/Expanded counts survive eviction/restart; evicted cards are excluded from future discovery reimports. Queue append, review, back navigation and cleanup remain consistent under concurrent actions.

## Phase 11 — Backend connection and automatic refill — Implemented; extended device acceptance pending

Implement the server from `backend-plan.md` in the new `backend/` folder, then connect the app. Phase 10's read-state/history schema must exist before enabling deletion or inventory synchronization.

Android integration implemented with Expo SecureStore pairing, local version-4 identity/history retention, persistent queue, transactional delivery outbox, coalesced foreground sync and Favorites. Seventeen mocked backend tests, expanded app data tests, a real fixture HTTP integration test, and both TypeScript checks pass. The user confirmed non-billed Gemini free-tier eligibility; the private `.env` selects gemini-3.8-flash with paid calls blocked. Live preparation and Samsung connection/refill are recorded separately in docs/manual-test.md.

- [x] Add explicit server URL, connection/pairing and provider-mode settings; never place Gemini/OpenAI keys in the app.
- [x] On connect, foreground/resume and coalesced meaningful inventory changes, send a fresh SQLite inventory snapshot to the backend.
- [x] Refill at 55 or fewer unread cards toward 60, with a minimum target of 50. Serve validated cached cards first; create generation jobs only for the remaining deficit.
- [x] Import acknowledged refill batches transactionally and idempotently; recompute actual unread count after deduplication. Persist retryable acknowledgments and do not count pending network deliveries as local cards.
- [x] Show bounded connection/refill status and a retry control. Offline or exhausted provider quotas may temporarily leave fewer than 50 unread cards; continue local reading without a blocking loader.
- [x] Keep public retrieval, AI-only generation and source-grounded AI preparation visibly distinct. AI-only explanations must be labeled unverified.
- [ ] Diagnose the original direct-phone Wikipedia 403 and record the result; successful backend retrieval does not establish that the phone request is repaired.
- [x] Verify capped provider calls, timeouts, no surprise provider switching/spend, crash/reconnect recovery and no leakage of keys to logs or the APK.
- [ ] Complete extended device stress acceptance for 31+ reads, 40+ favorites, crash timing, and the entire offline retention/refill lifecycle. A rebuilt APK is installed; basic Favorites, reader returns, pairing and live refill were checked separately.

**Exit criteria:** with a reachable configured backend and sufficient cache/quota, a phone with fewer than 50 unread cards refills to the buffer target; normal reading proactively replenishes. Disconnection still permits offline reading, favorites remain safe, and no more than 30 read non-favorite bodies remain after cleanup. Offline shortages and live-provider acceptance are reported separately.

## Scope guardrails

- Do not publish the app or add paid infrastructure as part of this plan.
- Do not add ads, social feeds, autoplay, engagement counters, streak pressure, or notifications designed to pull the user back into the app.
- Do not let analytics, provider setup, or AI mode block the local-first reading experience.
- Do not silently broaden scope. Add new features as a separate phase or update the acceptance criteria before implementation.
