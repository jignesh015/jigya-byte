# JigyaByte

Dark-only Android learning cards, stored locally with Expo SQLite. Feed, details, favorites, interests, reviews and analytics work without a PC service. Wikipedia discovery is the default online provider. Local AI is optional and off by default.

## Personal APK

Run `npm install`, then `npm run apk` with Node 22.13+ (Node 24 for the tests), JDK 17+ and an Android SDK installed. The build script accepts `-SdkPath` and `-JdkPath`, uses `ANDROID_HOME` / `JAVA_HOME`, or falls back to the installed Unity 6000.3.8f1 Android tools. The first build downloads Gradle/Android dependencies. No EAS account or cloud build is needed.

The resulting `artifacts/JigyaByte.apk` includes its JavaScript and launches without Metro. It is an ARM64 personal testing release signed with the generated development key, not a store distribution build. Keep the signing key stable for future updates. App identity: `com.jigyabyte.app`. Version: 1.0.0. The target phone for this handoff is Samsung SM-S901E / Android 16. The extra 32-bit build hit a Windows CMake path-length error and is excluded from the default build.

Connect your phone with USB debugging enabled and accept its authorization prompt:

```powershell
adb devices
adb install -r artifacts/JigyaByte.apk
adb shell am start -n com.jigyabyte.app/.MainActivity
```

An update with the same package/signing key preserves local data. Do not uninstall just to update. If Android rejects the signature, back up data before deciding to uninstall.

## Manual test

The user marked the manual gate passed for now on 2026-10-10. Wikipedia discovery returns HTTP 403 and remains an open issue; real-model AI acceptance is not inferred. Keep `docs/manual-test.md` as the repeatable checklist. Desktop SQLite and successful APK builds alone do not establish device acceptance.

The installed APK now includes Favorites, a persistent queue, read-card retention and automatic backend replenishment. It targets 60 unread cards when supply is available, caps read non-favorite bodies at 30, and preserves favorites and compact all-time history. Starter samples are removed in schema version 5; only imported provider cards remain. The previous live run cached 25 Gemini cards before an uncertain upstream timeout stopped generation; cached reading remains available. Extended device stress acceptance is pending in `docs/manual-test.md`.

## Backend connection

For a desktop launcher on Windows, run `npm run backend:launcher`, then copy
`artifacts/backend-launcher/JigyaByte Backend.exe` to your desktop. Double-click
to start the server; keep its window open and press Ctrl+C to stop it. The project
folder and installed Node runtime must stay in place. See `backend/README.md`.

Keep provider keys only in the ignored `backend/.env`. Start the PC server with `npm run backend`, then apply `adb reverse tcp:4319 tcp:4319` for a USB-connected phone. In **Topics → Backend connection**, enable automatic refill, use `http://127.0.0.1:4319`, enter `BACKEND_DEVICE_TOKEN` from the private environment file, and save. The Samsung is already paired; reapply USB reverse after reconnecting it. Android stores pairing settings in SecureStore and never receives the Gemini key. See `backend/README.md` for setup, limits and recovery.

## Optional local AI

Install Ollama and a local model yourself if wanted. The app does not download models or call paid APIs. Use an already installed model from `ollama list`; start Ollama with cloud disabled (`OLLAMA_NO_CLOUD=1`). In a second terminal:

```powershell
$env:OLLAMA_MODEL = 'your-installed-local-model'
npm run service
```

The service only contacts Ollama at `127.0.0.1:11434`, rejects cloud/remote models, and listens at `127.0.0.1:4318`. No API key is needed. It provides `GET /health`, `GET /cards` (up to 100 cached generated cards), and `POST /generate` with `{"topicId":"space"}`. Generation has a timeout, one concurrent request, bounded output and input validation. The phone stores imported cards permanently in SQLite; the PC cache is separate.

For USB access:

```powershell
adb reverse tcp:4318 tcp:4318
```

In the app open **Topics**, enable **Optional local AI**, use `http://127.0.0.1:4318`, and save. Reopen Topics and tap **Generate one AI card**. Generated cards are appended to the deck and labeled unverified. If generation fails, dismiss the message and use public discovery or keep reading locally. There are no startup calls to the PC.

For LAN access, explicitly set `$env:JIGYABYTE_HOST = '0.0.0.0'` before starting the service, and enter your PC's private LAN address in the app. Permit port 4318 only on your trusted private network; the service has no account/authentication layer. Do not expose it through a router or public tunnel. Android cleartext HTTP is enabled for this personal local-service path; client settings accept only loopback/private IPv4 addresses. USB reverse must be reapplied after reconnecting the phone.

## Local data and reset

SQLite owns all interactions and settings. Seen and Expanded count each card once, under its primary topic; Favorites counts currently saved cards. Again schedules 10 minutes later, Got it 1 day later, Easy 7 days later. Restart the app after a review becomes due to rebuild the schedule.

Android Settings → Apps → JigyaByte → Storage → Clear storage resets all local cards, favorites, review dates and settings. This is destructive. Next launch has an empty library; connect the backend or import public cards to populate it. Clearing the PC's `service/.cache` only removes the PC cache and never resets the phone.

For a deliberate personal backup, close the app and use Android Studio Device Explorer to copy the app's `files/SQLite` directory, including any `jigyabyte.db-wal` / `jigyabyte.db-shm` files present. This requires a debuggable build (`npx expo run:android`, with Metro running), and is not available through `run-as` on the standalone release. The release has no in-app export/import feature yet; Android system backup is best-effort and must not be your only backup. Keep the installed release/data intact for routine testing and updates.

## Development and checks

Before publishing, run `npm run audit:public`. It checks files eligible for Git
against local environment credentials and common secret patterns, and verifies
the ignore rules without printing secrets. It does not scan commit history.
All `.env` files and variants, local databases, signing keys, IDE state and build
artifacts are excluded by the root `.gitignore`. The safe configuration template
is `backend/env.example`; copy it to `backend/.env` for a fresh installation.

`npm start` starts Expo Go review; `npm run android` builds/runs the native development app. Expo Go requires a compatible SDK 57 build. `npm run typecheck` checks TypeScript. `npm test` runs repository SQL against a temporary desktop SQLite file (including close/reopen), plus HTTP service tests with a stub local model. Tests require localhost access and do not call a real model or Wikimedia.

Build guidance: [Expo local builds](https://docs.expo.dev/guides/local-app-production/). Local model setup: [Ollama API](https://docs.ollama.com/api/introduction) and [cloud disable configuration](https://github.com/ollama/ollama/blob/main/docs/faq.mdx).
