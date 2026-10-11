# JigyaByte

JigyaByte is a local-first Android app for quick, memorable discoveries. Its feed mixes broad-topic cards, personal interests and spaced review. Cards should feel like a fun fact, an unexpected connection, a question worth thinking about, or a useful game/software development tip—not a textbook summary.

## How new cards are made

The Gemini API is the only content-generation provider. A PC backend sends a structured prompt to Gemini and syncs the resulting cards to the phone. The app does not fetch Wikipedia or use a local model. Gemini cards have no live references and are labeled unverified; check important claims independently. The Gemini API key stays in the ignored `backend/.env` file and never goes on the phone.

The backend is optional for reading. Cards already saved in the app stay available offline, but creating more cards requires the backend to be running and paired with the app. To connect, open **Topics → Backend connection**, enable automatic refill, set the PC's private LAN address (or use USB forwarding), enter `BACKEND_DEVICE_TOKEN`, and save. See [backend/README.md](backend/README.md) for setup and retry details.

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

The configured fallback chain is Gemini 3.8 Flash followed by Gemini 3.6 Flash. A model failure can advance once to the fallback; each attempt uses the existing local request and token budget. Paid calls remain disabled. Retry does not reset daily usage.

## Local data and checks

SQLite on the Android device owns saved cards, favorites, interests, review state and reading history. App schema 6 cleared the old card library during its migration; schema 7 removes the retired local-generator preference. Backend schema 6 clears old cached card bodies and deliveries and drops cached Wikipedia excerpts while preserving budget reservations and duplicate history.

`npm run typecheck` and `npm run backend:typecheck` check TypeScript. `npm test` runs the local data and fixture integration checks; `npm run backend:test` runs the backend suite. These checks do not establish live Gemini availability or phone visual acceptance. See [docs/manual-test.md](docs/manual-test.md) for the current manual checklist.

Before publishing, run `npm run audit:public`. The audit checks files eligible for Git against common credential patterns without printing secrets. `.env` files, local databases, signing keys and build artifacts are ignored.
