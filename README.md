# JigyaByte

JigyaByte is a local-first Android app for quick, memorable discoveries. Its feed mixes broad-topic cards, personal interests and spaced review. Cards should feel like a fun fact, an unexpected connection, a question worth thinking about, or a useful game/software development tip—not a textbook summary.

## How new cards are made

The Gemini API is the only content-generation provider. A PC backend batches cards and syncs them to the phone. Free public feeds and endpoints provide recent news with source links and dates saved alongside those cards; evergreen cards use model knowledge. All cards remain AI-generated and unverified. The Gemini key stays in ignored `backend/.env` and never goes on the phone. Generation randomly balances the 27 topics and caches surplus to reduce daily requests.

The backend is optional for reading. Cards already saved in the app stay available offline, but creating more cards requires the backend to be running and paired with the app. To connect, open **Settings → Topics → Backend connection**, enable automatic refill, set the PC's private LAN address (or use USB forwarding), enter `BACKEND_DEVICE_TOKEN`, and save. Settings has a fixed-size bottom panel with a glowing connection indicator, last successful connection time, local unread count and refresh button. See [backend/README.md](backend/README.md) for setup and retry details.

## Run the app and backend together

They use separate ports: Expo/Metro uses `8081`, and the backend uses `4319` (`BACKEND_PORT` in `backend/.env`). Start each in its own terminal from the project root:

```powershell
# Terminal 1: Expo app
npm start

# Terminal 2: backend API
npm run backend
```

Keep both terminals open while developing. For a phone on Wi-Fi, set `BACKEND_HOST` to the PC's private Wi-Fi IPv4 address and connect the phone to `http://<PC-Wi-Fi-IPv4>:4319`. For USB, run `adb reverse tcp:4319 tcp:4319` and use `http://127.0.0.1:4319` in the app. See [backend/README.md](backend/README.md) for backend setup.

## Build and install

Run `npm install`, then `npm run apk` with Node 22.13+ (Node 24 for backend tooling), JDK 17+ and an Android SDK. The build script uses `ANDROID_HOME` / `JAVA_HOME` or the installed Unity Android tools. The result is `artifacts/JigyaByte.apk`, an ARM64 personal testing build signed with the generated development key. Keep that key stable for updates. App identity: `com.jigyabyte.app`.

```powershell
adb devices
adb install -r artifacts/JigyaByte.apk
adb shell am start -n com.jigyabyte.app/.MainActivity
```

An update with the same package and signing key preserves local data. Do not uninstall just to update. If Android rejects the signature, back up data before deciding to uninstall.

## Run the backend

Keep provider credentials in `backend/.env`; use `backend/env.example` as a template for a new setup. Configure the Gemini model, fallback model, device pairing token and host address, then run:

```powershell
npm run backend
```

The configured fallback chain is Gemini 3.8 Flash → Gemini 3.6 Flash → Gemini 3.5 Flash-Lite → Gemini 3.1 Flash-Lite. Retryable model failures advance through the chain after bounded backoff, trying each model once. Each attempt uses the shared local budget of 30 requests and 725,760 reserved tokens per UTC day. Paid calls remain disabled. Retry does not reset daily usage.

## Local data and checks

SQLite on the Android device owns saved cards, favorites, interests, review state and reading history. App schema 6 cleared the old card library during its migration; schema 7 removes the retired local-generator preference. Backend schema 6 clears old cached card bodies and deliveries and drops cached Wikipedia excerpts while preserving budget reservations and duplicate history.

`npm run typecheck` and `npm run backend:typecheck` check TypeScript. `npm test` runs the local data and fixture integration checks; `npm run backend:test` runs the backend suite. These checks do not establish live Gemini availability or phone visual acceptance. See [docs/manual-test.md](docs/manual-test.md) for the current manual checklist.

Before publishing, run `npm run audit:public`. The audit checks files eligible for Git against common credential patterns without printing secrets. `.env` files, local databases, signing keys and build artifacts are ignored.
