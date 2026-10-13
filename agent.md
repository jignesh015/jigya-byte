# JigyaByte Agent Guide

Current source and generation policy (2026-10-12; user-authorized): free live retrieval is enabled for news cards. Use only the implemented no-key public endpoints (PIB RSS/official releases, UN News RSS, GDELT Context, GitHub releases and official Steam announcements); do not enable paid news/search/grounding services. Gemini remains the sole generation provider and paid calls stay disabled. News requires dated, sufficiently detailed fresh source material; skip unavailable news topics rather than inventing headlines. Attach only backend-resolved source links and dates, persist them offline, and label summaries AI-generated and unverified. This supersedes older no-retrieval statements below.

Current batching/distribution policy (2026-10-12): generation randomly balances the least-generated available topics using persisted counts, without personal-interest weighting. Keep the app's discovery/interest/review feed lanes. Fill a token-sized generation batch and cache surplus for later refills; deliver at most ten cards per sync. `GENERATION_BATCH_SIZE=30` is an upper bound, with output capacity estimated at 350 tokens/card plus 512 tokens headroom. The current 8,192 output ceiling targets at most 21 cards/request and may shrink for input/daily-token/cache limits. Keep the configured daily caps and usage ledger; reserve actual prompt/schema bytes plus the output ceiling per attempt. Do not automatically retry bad credentials, incomplete/refused responses or malformed output. Backend schema 7 preserves cards and budgets while adding source cache, used-source IDs and topic-generation counts. App schema remains 7. Older fixed ten-card generation descriptions below are historical.

Current card editorial and content policy (2026-10-11): all new cards come from the Gemini API through the server-only backend. Do not fetch or cite Wikipedia or another source, and do not use a local model or another provider. Cards should earn a “Wow, I didn't know that!” or “That makes me think” reaction: one memorable fact, surprising connection, vivid comparison, reflective question, or practical game/software development technique. Avoid textbook definitions, lecture-like summaries, academic framing, generic filler, and heavy jargon outside game development and software development. Use familiar language for every other subject. Keep the summary to one clear sentence and the detail to 2–4 short, conversational sentences. Prefer well-established claims Gemini can state confidently; never invent details or exaggerate for effect. Cards are Gemini-generated and unverified because the backend makes no live-reference requests; tell readers to check important claims independently.

Current content reset (2026-10-11): app schema version 6 previously cleared the card library once. Backend database version 6 clears existing cached card bodies and deliveries and drops its cached-source table once; app schema version 7 removes the retired local-generator setting while preserving preferences and other local state. The backend preserves duplicate history and provider budget reservations. A clean installation starts empty. Gemini prepares up to ten distinct cards in one structured request, bounded by demand, cache capacity and existing budgets. Favorites use the custom SVG heart.

Current backend operation: generation runs only when the user starts the backend on their PC and enables its authenticated app connection. Keep Gemini keys in ignored `backend/.env`; never place them in the app. The user's requested daily ledger reset and configured 15-request / 362,880-token caps are historical context; inspect the local database before claiming current usage. The user requested that the backend remain stopped so they can start it themselves.

Current interaction policy: Settings is the fourth persistent destination after Feed, Favorites and Analytics. Topics is an option in Settings. A fixed-size panel above navigation on Settings contains a glowing green/red backend connection dot, last successful connection time, authoritative local unread count and an icon-only Refresh action retaining explicit retry behavior. Authenticated connection checks run every five seconds while the app is active; retain the last confirmed dot color during checks and keep the successful timestamp through failures. Feed uses pull to refresh at the top of the deck; imports append without moving the current card. Feed paging is owned by the app gesture handler with native touch scrolling disabled, so short vertical swipes do not compete with native snapping. Heart toggles use a short spring pulse and reader entry uses a 240ms slide/fade, both disabled when Android requests reduced motion.

Current fallback policy (2026-10-11): the configured Gemini chain is Gemini 3.8 Flash → Gemini 3.6 Flash. On a Gemini provider/model failure, the worker advances once to the configured Gemini 3.6 model after bounded backoff and reserves that attempt separately. If Gemini 3.6 times out, the job remains uncertain for explicit user retry. There is no other provider fallback. SQLite version 4 persists route selection and sanitized attempt diagnostics.

Current local budget (2026-10-11): configured request and reserved-token caps are 15 and 362,880 (15 × the existing 16,000 input + 8,192 output bounds). Google's independent quotas apply. Paid calls remain blocked.

Timeout recovery: a Gemini 3.8 model-call error advances once to the configured Gemini 3.6 fallback, as explicitly requested. Each attempt keeps its own reservation. If Gemini 3.6 times out, the job remains uncertain; an explicit Retry can start the chain again because paid calls remain disabled. The local Gemini request timeout is 60 seconds.

Historical provider diagnosis: captured HTTP 503 / UNAVAILABLE explicitly said the model was experiencing high demand. Backend jobs retain sanitized diagnostics. Local Gemini 3.8 uses low thinking; provider retries wait roughly 10/20 seconds plus jitter. Google's independent quotas still apply. See backend README for the recorded diagnostic evidence.

## Product

JigyaByte is a personal, zero-cost, local-first Android app for discovering bite-sized learning cards while the user is waiting. It is a satisfying alternative to social-media doomscrolling, covering game design and a broad range of other subjects. It is for personal use and is not currently intended for public release.

The app name is **JigyaByte**. Preserve this spelling and capitalization in user-facing copy.

## Product requirements

- Build an Android app, not a PWA. The user chose Android to avoid PWA setup concerns such as HTTPS.
- Keep core reading, navigation, saved cards, reviews, and analytics available from local storage. The app should remain useful when the PC service or internet is unavailable.
- Keep the project free to operate. Never enable a paid API, create a billable resource, or incur a charge without explicit user approval. Provider free tiers and quotas can change; do not present them as guaranteed.
- Generate all new content with Gemini through `backend/`; do not call Wikipedia, local models, OpenAI or another provider. The Gemini key and upstream requests remain server-side.
- Treat the PC-hosted Gemini backend as optional for reading, not for generation. The app must open, preserve local state and read saved cards offline when the PC or internet is unavailable.
- The backend owns Gemini prompts, validation, duplicate checks, budgets, cache, jobs and authenticated sync. New installs default to disabled generation until explicitly configured. See `backend/README.md` and `docs/manual-test.md` for current operation and acceptance status.
- New cards have no external references and must be labeled Gemini-generated and unverified. Never make up attribution, citations, or URLs.

## Feed and topics

The target feed mix is:

- 70% random discoveries across the supported topic pool.
- 20% cards from the user's personal interests.
- 10% due review cards.

The topic pool is **Game Design, Science, History, Geography, Space, Economics, Psychology, Technology, Philosophy, Biology, Literature, Tech Tips, Game Industry Stories, AI Updates, Agentic Coding, Game Industry News, Indie Games, Current Affairs, General Knowledge, Cinema (Bollywood & Hollywood), Ancient History, Indian History, Ancient India, Indian Myths and Epics, Art, Product Design, and UX**. Philosophy retains its existing ID. Keep topics configurable rather than hard-coding them into feed components. History cards distinguish evidence from disputed claims; myths and epics are attributed to texts or traditions rather than presented as verified history. AI Updates, Game Industry News and Current Affairs currently cover dated, confidently known developments; without live retrieval, do not promise latest news. Keep backend and app topic IDs aligned so new cards can be imported, selected as interests and counted in analytics.

For a practical first scheduler, use a shuffled ten-slot block with seven discovery slots, two interest slots, and one review slot. Avoid recently shown cards and near-duplicates. If a lane is empty, fill from discovery and record which lane supplied the card; do not leave a blank feed.

Review cards should be scheduled from prior learning cards. Keep the initial review scheduling simple and deterministic; do not add a complex spaced-repetition system without a product need.

## Navigation and interaction

- The main Feed is a vertically paged sequence of full-height cards, one card per feed screen. Swiping up advances to the next card; advancing must not require tapping a “Got it” button.
- A leftward horizontal swipe anywhere in the Feed screen opens the currently displayed card's expanded learning view. Avoid starting the app gesture in Android's system-back edge zones. Provide a visible, accessible “More” affordance as an alternative to the gesture.
- The expanded view has a clear back arrow and “Back to feed” label. Returning must preserve the exact feed card and scroll position.
- Keep the expanded view focused on reading. Both its back control and Android's system back button return to the feed.
- Provide persistent bottom navigation between **Feed** and **Analytics** on the two main screens, with a clear selected state. Do not hide the only route to Analytics.
- Persistent main destinations are **Feed, Favorites, Analytics, Settings**, in that order. Settings contains Topics and the bottom connection panel. Favorite details return to Favorites; feed details return to the exact feed position. Keep the library available offline.
- Resolve gesture direction deliberately: vertical movement scrolls the feed; horizontal movement opens details. Avoid starting the app gesture in system-back edge zones, and retain a tappable alternative.

## Analytics

Provide an Analytics screen with a category bar graph for **Seen**, **Expanded**, and **Favorites**. A metric selector may show one readable horizontal bar chart at a time. Show an all-time view by default; additional date ranges are optional.

Use stable, understandable counting rules:

- **Seen:** unique cards viewed, counted once per card.
- **Expanded:** unique cards whose details were opened, counted once per card.
- **Favorites:** cards currently saved as favorites; removing a favorite updates the count.

If a card has multiple topic tags, assign a primary topic for category reporting or clearly disclose that category totals can overlap. Never imply that repeat views are unique cards.

## Visual and interaction style

- Dark mode only. Do not add a light theme or automatic light-mode switching.
- Keep the interface minimal, polished, readable, and touch-friendly. Use strong text contrast and respect Android system insets and navigation controls.
- The current visual exploration is a charcoal/soft-ivory palette with a restrained lime accent (“Discovery Deck”). This is a design direction, not a finalized design system; preserve dark-only behavior while allowing the user to refine colors.
- Keep cards focused on one idea. Images are optional; do not require heavy imagery for every card or topic.
- Use motion to clarify scroll and navigation state. Avoid blocking transitions, autoplay, ads, social engagement counters, and manipulative retention mechanics. Favor clear session progress and natural stopping points while keeping the user's requested scrolling feed.

## Data and implementation guidance

- Treat the Android device's local database as the source of truth for user preferences, feed interactions, favorites, review state, and analytics.
- Store content and user interaction history separately so a card can be seen, expanded, favorited, and reviewed without duplicating its body text.
- Use stable provider IDs and content hashes for idempotent imports and duplicate detection.
- Keep Gemini prompts, generation, validation and backend transport behind the existing boundaries. Provider failures should not prevent reading cached content; do not reintroduce source retrieval or alternate model providers.
- Prefer small, reviewable changes that preserve these product requirements. Do not add dependencies or choose a backend/platform architecture solely from this guide when the existing project or user provides a different direction.

## Locked implementation decisions (Phase 0)

- **Android stack:** React Native with Expo SDK 57 and TypeScript. Expo Go is the initial manual review path; an installable Android binary is a later phase.
- **Local persistence:** Expo SQLite with the built-in async API. Version schema changes with `PRAGMA user_version` migrations. Keep SQL and persistence behind a repository boundary; SQLite on the Android device is authoritative.
- **Content generation:** Gemini API through the PC backend only. There is no public-source discovery or local model path. A backend connection is needed to generate new cards, but never to read saved cards.
- **Categories:** cards may have multiple topic tags; each card has one required primary topic for non-overlapping analytics. The primary topic is also the default display category.
- **Initial review actions:** “Again” schedules 10 minutes later, “Got it” schedules 1 day later, and “Easy” schedules 7 days later. These deterministic intervals are an MVP starting point, not an adaptive spaced-repetition algorithm.
- **Feed session:** full-screen vertical paging, with no session progress counter in the MVP.
- **Feed composition:** keep the requested shuffled ten-slot 70/20/10 mix for Phase 4.
- **Cost guard:** paid API calls remain disabled. Confirm provider quota and cost mode before enabling any paid model configuration.

Tradeoffs: Expo allows fast Android iteration and Expo Go review with the requested toolchain; SQLite keeps personal state local and available offline. Gemini supplies new cards only when the optional PC backend is available; saved cards remain readable offline.

## Phase 7 implementation decision

- This phase description is historical. The current implementation uses the Gemini API through `backend/`; the old local Ollama and Wikipedia paths have been removed.
- Gemini generation is the sole path for new content. Cards are stored in the same offline library and labeled unverified; do not present Gemini as an independent factual source.
- The backend exposes authenticated sync and status endpoints plus `/health`; it calls only Gemini. It binds according to its local configuration; phone access can use USB `adb reverse` or a private LAN host. No model call is made unless the configured backend has a generation job.
- Personal APK builds bundle the JavaScript for independent offline launch. Device installation and visual review are separate acceptance steps.

## Future decisions

The current implementation uses the locked Expo, TypeScript, and Expo SQLite choices above. Gemini generation remains outside the core reading path. Do not add another content provider or paid API call without explicit approval. Later visual refinements and any review scheduling beyond the fixed MVP intervals can be decided after manual device review.

## Accepted next scope (2026-10-10; documentation only)

- The user's earlier manual pass predates the current Gemini-only card flow. Retest card generation, the curiosity-first writing quality, backend retry/fallback and offline reading on the phone; do not treat the older Wikipedia flow's acceptance as coverage of this change.
- Maintain at least 50 locally available unread cards as the connected-state target. Refill proactively at 55 or fewer toward 60, using cached backend cards first. The app reports authoritative inventory to the server; the server cannot inspect phone SQLite directly. Offline use or provider failures can reduce this count; reading must never block to enforce the target.
- A card is read on its first meaningful Seen impression, including first reading from Favorites/details. Expanded and review actions are not required to mark it read. Read/unread state survives restart.
- Keep at most 30 read, non-favorite card bodies on the phone; remove the oldest by first-read time. Favorites are never automatically deleted and do not count toward that cap. Unread cards are never deleted by read-history cleanup. Thus total local cards can exceed 80, especially when favorites accumulate.
- Keep compact identity/hash, read/expanded flags, original primary-topic and timestamp records after body eviction so all-time analytics and duplicate exclusions survive. Existing cascading foreign keys must be migrated before enabling cleanup. These records are not retained readable cards.
- Scheduled reviews do not exempt non-favorites from retention. Evicting their bodies removes local pending review eligibility, while preserving review-action history. Retained/favorite cards continue to use the existing deterministic review rules.
- Persist the queue and append refill results without reshuffling the active deck. Keep the 70/20/10 lane scheduler: unread discovery/interest cards plus eligible retained reviews. Opening Favorites does not advance the currently displayed feed page, although a first view updates read state; future unread lanes skip cards already read through Favorites.
- Add an offline Favorites library in Phase 9. Removing a favorite changes the library and analytics immediately and makes a read card eligible for cleanup; defer eviction of an actively open body until it is safe to leave that view.
- The backend's active cloud provider is Gemini only, with explicit model, key and budget configuration. Keep paid generation disabled; verify free-tier availability and provider quota before deliberate live generation.
