# JigyaByte Agent Guide

Current content policy (2026-10-11): ship no starter/sample cards. Schema version 5 removes the old `jigyabyte-sample` cards and associated local sample interactions/favorites/reviews; imported provider content is preserved. A clean installation starts empty and obtains real cards through explicit public import or a configured backend. Gemini preparation supplies up to ten distinct cards in one structured request, bounded by remaining demand, cache capacity and existing budgets. Favorites use a custom SVG heart, never a text glyph.

Current interaction policy: backend status and Retry belong on Analytics. Feed uses native pull to refresh at the top of the deck; imports append without moving the current card. Heart toggles use a short spring pulse and reader entry uses a 240ms slide/fade, both disabled when Android requests reduced motion.

Current fallback policy (2026-10-11): explicitly approved free chain Gemini 3.8 Flash → Gemini 3.6 Flash, only for definitive generation overload/429 errors. All attempts share existing daily budgets; never reset usage to enable fallback. SQLite version 4 persists route selection and sanitized attempt diagnostics. No fallback on uncertain timeout, credentials, refusal or validation failures. OpenAI is wired as an optional second fallback with quickstart model `gpt-6-astra`, but the user explicitly chose to keep it disabled after clarification that ChatGPT Plus does not include API-key usage. Keep `OPENAI_FALLBACK_ENABLED=false` and paid calls blocked unless subsequently approved.

Current local budget (2026-10-11): the user subsequently approved increasing the backend daily request cap from 12 to 15. The companion reserved-token cap is 362,880 (15 × the existing 16,000 input + 8,192 output bounds). Preserve all accumulated reservations; this changes limits without resetting usage. Google's independent quotas still apply. Paid calls and OpenAI fallback remain disabled.

Timeout recovery: uncertain calls never retry automatically. Explicit Retry may replace an uncertain call only for confirmed free Gemini with paid calls disabled; preserve the original budget reservation and reserve each new attempt. Uncertain paid calls require reconciliation. The local Gemini request timeout is 60 seconds.

Current provider diagnosis: captured HTTP 503 / UNAVAILABLE explicitly says the model is experiencing high demand. Backend version-3 jobs retain sanitized diagnostics. Local Gemini 3.8 uses low thinking; overload retries wait roughly 10/20 seconds plus jitter. The investigation exhausted the unchanged 12-request daily cap; do not claim live recovery or reset budgets to bypass it. See backend README for the single-request diagnostic command and exact evidence.

## Product

JigyaByte is a personal, zero-cost, local-first Android app for discovering bite-sized learning cards while the user is waiting. It is a satisfying alternative to social-media doomscrolling, covering game design and a broad range of other subjects. It is for personal use and is not currently intended for public release.

The app name is **JigyaByte**. Preserve this spelling and capitalization in user-facing copy.

## Product requirements

- Build an Android app, not a PWA. The user chose Android to avoid PWA setup concerns such as HTTPS.
- Keep core reading, navigation, saved cards, reviews, and analytics available from local storage. The app should remain useful when the PC service or internet is unavailable.
- Keep the project free to operate. Never enable a paid API, create a billable resource, or incur a charge without explicit user approval. Provider free tiers and quotas can change; do not present them as guaranteed.
- Support two content modes in the design: public/free information providers and AI-generated content. Make provider choice explicit. Do not put provider secrets in the Android client; if a key is needed, keep it in a local service or user-managed secure configuration.
- Treat the PC-hosted service as optional. It may discover, generate, and cache content, but it must not be required to open the app or read locally stored cards.
- The server in `backend/` supports explicitly configured Gemini and OpenAI adapters, durable cache/jobs/budgets and authenticated sync. New installations default to disabled generation; provider keys live only in its ignored `.env`. Android connection, Favorites, persistent queue and version-5 retention/history migration with all starter samples removed are implemented. The current local setup explicitly selects Gemini `gemini-3.8-flash`; the user confirmed a free-tier project with billing disabled. Paid calls remain blocked. Provider keys, retrieval, prompts, validation, caching and upstream API calls belong on the server. The existing `service/` remains an implemented local-Ollama prototype. See `backend-plan.md`, `backend/README.md`, and `docs/manual-test.md` for current validation and limits.
- Preserve source title, source URL, attribution, license, provider ID, and retrieval time for externally sourced cards. Show useful attribution with the card or its details.

## Feed and topics

The target feed mix is:

- 70% random discoveries across the supported topic pool.
- 20% cards from the user's personal interests.
- 10% due review cards.

The preferred topic pool is **Game Design, Science, History, Geography, Space, Economics, Psychology, Technology, Philosophy, and Biology**. Keep topics configurable rather than hard-coding them into feed components.

For a practical first scheduler, use a shuffled ten-slot block with seven discovery slots, two interest slots, and one review slot. Avoid recently shown cards and near-duplicates. If a lane is empty, fill from discovery and record which lane supplied the card; do not leave a blank feed.

Review cards should be scheduled from prior learning cards. Keep the initial review scheduling simple and deterministic; do not add a complex spaced-repetition system without a product need.

## Navigation and interaction

- The main Feed is a vertically paged sequence of full-height cards, one card per feed screen. Swiping up advances to the next card; advancing must not require tapping a “Got it” button.
- A leftward horizontal swipe anywhere in the Feed screen opens the currently displayed card's expanded learning view. Avoid starting the app gesture in Android's system-back edge zones. Provide a visible, accessible “More” affordance as an alternative to the gesture.
- The expanded view has a clear back arrow and “Back to feed” label. Returning must preserve the exact feed card and scroll position.
- Keep the expanded view focused on reading. Both its back control and Android's system back button return to the feed.
- Provide persistent bottom navigation between **Feed** and **Analytics** on the two main screens, with a clear selected state. Do not hide the only route to Analytics.
- **Favorites** is the third persistent main destination: Feed, Favorites, Analytics. Favorite details return to Favorites; feed details return to the exact feed position. Keep the library available offline.
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
- Keep provider discovery, normalization, and AI generation behind separate interfaces. Provider failures should not prevent reading cached content.
- Prefer small, reviewable changes that preserve these product requirements. Do not add dependencies or choose a backend/platform architecture solely from this guide when the existing project or user provides a different direction.

## Locked implementation decisions (Phase 0)

- **Android stack:** React Native with Expo SDK 57 and TypeScript. Expo Go is the initial manual review path; an installable Android binary is a later phase.
- **Local persistence:** Expo SQLite with the built-in async API. Version schema changes with `PRAGMA user_version` migrations. Keep SQL and persistence behind a repository boundary; SQLite on the Android device is authoritative.
- **PC service:** optional. It may support later content discovery, but launch, reading cached provider content, preferences, and interactions must work with no PC service and no internet.
- **Initial public provider:** English Wikipedia via the Wikimedia REST API, introduced in Phase 5. It covers the preferred topic range and returns source pages for attribution. Treat rate limits as changeable: use a descriptive User-Agent where the platform permits, cache results, keep requests bounded, and honor `Retry-After` for 429/503 responses. Reused text needs a source-page link, license link, and a note that the app edited/adapted the text; check each page's applicable license. The app is personal-use only, but retain these fields in the data model.
- **Categories:** cards may have multiple topic tags; each card has one required primary topic for non-overlapping analytics. The primary topic is also the default display category.
- **Initial review actions:** “Again” schedules 10 minutes later, “Got it” schedules 1 day later, and “Easy” schedules 7 days later. These deterministic intervals are an MVP starting point, not an adaptive spaced-repetition algorithm.
- **Feed session:** full-screen vertical paging, with no session progress counter in the MVP.
- **Feed composition:** keep the requested shuffled ten-slot 70/20/10 mix for Phase 4.
- **Cost guard:** no paid APIs, billable resources, or AI provider calls are enabled. Public-source access is best-effort and never required for local reading.

Tradeoffs: Expo allows fast Android iteration and Expo Go review with the requested toolchain; SQLite keeps personal state local and available offline. Wikimedia offers broad topic coverage and reusable text, while attribution/share-alike obligations mean imported and adapted content must retain provenance and license metadata.

## Phase 7 implementation decision

- Optional AI uses a user-started Node PC service and an already installed local Ollama model. No cloud adapters, keys, billing, or automatic model downloads are implemented.
- Public Wikipedia discovery remains the default. AI generation is separately opt-in in Topics/settings, labels every generated card, and stores it in the same offline library. Generated text is unverified and must not be presented as a factual source.
- The PC service exposes `/health`, `/cards`, and `/generate`; only `/generate` invokes a model. It binds to loopback by default; phone access can use USB `adb reverse` or an explicitly configured LAN host. No PC service request is made at startup.
- Personal APK builds bundle the JavaScript for independent offline launch. Device installation and visual review are separate acceptance steps.

## Future decisions

The current implementation uses the locked Expo, TypeScript, and Expo SQLite choices above. The optional local PC service and AI generator remain outside the core reading path. Do not add paid API calls without explicit approval. Later visual refinements and any review scheduling beyond the fixed MVP intervals can be decided after manual device review.

## Accepted next scope (2026-10-10; documentation only)

- The user marked manual testing passed for now. Wikipedia discovery returns HTTP 403 on the phone and remains an open issue; passing the manual gate does not mean that integration is fixed. No real-model AI acceptance is inferred from this decision.
- Maintain at least 50 locally available unread cards as the connected-state target. Refill proactively at 55 or fewer toward 60, using cached backend cards first. The app reports authoritative inventory to the server; the server cannot inspect phone SQLite directly. Offline use or provider failures can reduce this count; reading must never block to enforce the target.
- A card is read on its first meaningful Seen impression, including first reading from Favorites/details. Expanded and review actions are not required to mark it read. Read/unread state survives restart.
- Keep at most 30 read, non-favorite card bodies on the phone; remove the oldest by first-read time. Favorites are never automatically deleted and do not count toward that cap. Unread cards are never deleted by read-history cleanup. Thus total local cards can exceed 80, especially when favorites accumulate.
- Keep compact identity/hash, read/expanded flags, original primary-topic and timestamp records after body eviction so all-time analytics and duplicate exclusions survive. Existing cascading foreign keys must be migrated before enabling cleanup. These records are not retained readable cards.
- Scheduled reviews do not exempt non-favorites from retention. Evicting their bodies removes local pending review eligibility, while preserving review-action history. Retained/favorite cards continue to use the existing deterministic review rules.
- Persist the queue and append refill results without reshuffling the active deck. Keep the 70/20/10 lane scheduler: unread discovery/interest cards plus eligible retained reviews. Opening Favorites does not advance the currently displayed feed page, although a first view updates read state; future unread lanes skip cards already read through Favorites.
- Add an offline Favorites library in Phase 9. Removing a favorite changes the library and analytics immediately and makes a read card eligible for cleanup; defer eviction of an actively open body until it is safe to leave that view.
- Support cloud-provider capabilities in the new backend, with model/provider selection and key/budget configuration explicit. This documentation change performs no API calls or billing activation. Keep paid generation disabled until its provider/model and spend limits are explicitly approved; free-tier eligibility and quota must be verified at implementation time.
