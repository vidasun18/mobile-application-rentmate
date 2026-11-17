# RentMate

[Project repository](https://github.com/vidasun18/mobile-application-rentmate.git)

Agent-led tour transport for Sri Lanka: Flutter Android app and Express API. **Local mode uses a persistent SQLite file and local image files, with no database account, Docker or cloud storage required.** PostgreSQL and Cloudinary remain available options from the original proposal. The official 40-page proposal is preserved at the project root. Its screen images, role visibility table and lifecycle diagrams informed this implementation; direct Figma access was unavailable. Acceptance evidence is in `docs/PROPOSAL_AUDIT.md`.

## Windows quick start

Install Node.js 24.18 or newer. From the repository root:

```powershell
cd backend
npm.cmd ci
npm.cmd run local
```

Keep this terminal running. The API listens on port 3000. On first launch it creates:

* `.local/rentmate.db` — real SQLite database containing accounts, bookings, quotes, assignments, notifications and audit records.
* `.local/media/` — uploaded image files. Documents require expiring owner/admin access; administrative private reads require a recorded reason.
* `.local/local-config.json` — generated signing secret, preserved across restarts.
* `.local/demo-accounts.json` — five fictional demonstration accounts with unique generated passwords: tourist, agent, two drivers and administrator. The first empty database is seeded with vehicles, memberships and two example tours. Use the file to sign in; these are local demonstration accounts, not identity verification evidence.

Restarting `npm.cmd run local` preserves accounts and bookings. These private files are ignored by Git. Back up the database, configuration and media together while the API is stopped; do not delete `.local` to upgrade the schema. SQLite is intended for one local API process; PostgreSQL remains the option for shared deployments. The API must run on your computer while the Android app uses it.

Install Flutter stable, Android Studio/Android SDK and JDK 21 to run Android. In a second terminal from the repository root:

```powershell
cd mobile
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3000
```

`10.0.2.2` routes an Android emulator to the Windows host. For a physical phone on the same network, use the PC's LAN address and allow port 3000 through your local firewall. For consistent local image URLs across devices, set `PUBLIC_API_URL` to that same reachable address before uploading images. Android API 26 (8.0) is the minimum. Cleartext HTTP is enabled only in debug builds. For a release, provide an HTTPS API URL and your own keystore using `mobile/android/key.properties.example`; release builds refuse missing signing configuration.

### Connecting a physical phone

1. Keep `npm.cmd run local` running and connect the phone and laptop to the same Wi-Fi/hotspot.
2. Run `ipconfig` on the laptop and find the **Wi-Fi IPv4 address**. Ignore virtual-adapter and emulator addresses.
3. In the phone's browser, open `http://LAPTOP_WIFI_IP:3000/health`. It must show `{"data":{"status":"ok"}}`. If it cannot connect, check the network and port 3000 firewall access before trying a password.
4. In RentMate **Server connection** (on the welcome or Sign in page), enter `http://LAPTOP_WIFI_IP:3000`, tap **Test connection**, then **Save connection**. Use the base address without `/health`.
5. Sign in using the generated email/password from `.local/demo-accounts.json`. Server settings survive restarts and sign-out. Changing servers clears the old session and saved trips.

The new **`deliverables/RentMate-phone-debug.apk`**, version **0.1.1 (2)**, defaults to the laptop's 19 October Wi-Fi address `http://10.55.155.44:3000`. Install it over the earlier debug APK. If the address changes, update **Server connection** without rebuilding. The older `RentMate-debug.apk` is the original 0.1.0 emulator build; use the new phone APK on physical phones. Browser health access from the user's phone was confirmed; the rebuilt app still needs installation and its on-phone login check.

## Android phone server

For hosting on an Android phone instead of the laptop, install **`deliverables/RentMate-server-debug.apk`** on the host phone and follow [PHONE_SERVER_SETUP.md](docs/PHONE_SERVER_SETUP.md). The separate server APK built successfully for all three Android ABIs; 28 SQLite API tests and two Android unit tests pass. APK signing/alignment checks pass. Actual phone startup/background/hotspot checks remain pending because no ADB device is attached. The server and normal RentMate client are separate apps. See `server-android/README.md` for runtime provenance and rebuild instructions.

## Optional PostgreSQL setup

Install Docker Desktop and PowerShell 7; start Docker Desktop before using Compose.

From the repository root:

```powershell
pwsh -File scripts/setup.ps1
docker compose up --build
```

Setup generates local secrets in ignored `.env` files and refuses to overwrite existing configuration. Compose persists PostgreSQL in a named volume. It applies versioned migrations before starting the API. Do not remove the database volume to apply upgrades.

Provision the first administrator, choosing your own email and password:

```powershell
cd backend
npm.cmd ci
$env:PROVISION_EMAIL = 'your-admin@example.com'
$env:PROVISION_NAME = 'RentMate administrator'
$env:PROVISION_ROLE = 'ADMIN'
npm.cmd run provision
```

The provisioner generates a unique password if `PROVISION_PASSWORD` is absent and prints it once. Store it privately. Clear `PROVISION_*` variables after use. It refuses duplicate accounts; it never resets an existing password. Registration through the API cannot create administrators.

Without Docker, start PostgreSQL 17 or newer, set `backend/.env` from its example, then run `npm.cmd run migrate` and `npm.cmd start` inside `backend`. `/health` checks database connectivity. Never expose the database directly on a public network.

## Tests and Android build

`npm.cmd run local` handles SQLite migration and initial demo setup automatically. For an optional PostgreSQL demonstration after migrations, run `node scripts/seed-demo.js` inside `backend`. The seed refuses duplicate accounts and credential-file overwrites.

```powershell
cd backend
npm.cmd ci
npm.cmd run test:sqlite
npm.cmd run test:postgres
cd ../mobile
flutter analyze
flutter test
flutter build apk --debug --dart-define=API_URL=http://10.0.2.2:3000
```

The SQLite runner creates a separate real `.local/sqlite-test-*/test.db` file. The PostgreSQL runner uses a unique native server cluster started with `pg_ctl`, stopped afterward, and retained in ignored `.local/pg-test-*` for diagnostics. Both run the complete workflow/privacy/concurrency suite and leave the development database untouched. Additional tests check SQLite persistence/rollback and local document delivery. To use another **empty disposable test database**, set `TEST_DATABASE_URL` and run `npm.cmd test`. CI defines separate SQLite, PostgreSQL and Android jobs.

The APK is produced at `mobile/build/app/outputs/flutter-apk/app-debug.apk`. This work session also copied the verified final build to `deliverables/RentMate-debug.apk` (ignored by Git). Test evidence and remaining acceptance work are in `docs/TEST_RESULTS.md`. The local timing test does not establish production mobile-network performance.

## Services

Local mode supports image upload/review and the database notification inbox without external credentials. Firebase push still requires a Firebase project; unavailable delivery is explicitly reported and inbox records are retained.

* Local images: `npm.cmd run local` sets `LOCAL_MEDIA_DIR`. JPEG/PNG uploads are limited to 5 MB. Private documents have no public URL in the database. Owner/admin view links expire after 60 seconds and are rechecked against current account/session state. Local public photos require review and an approved owner. Pending photos can be inspected with the View action before approval. Local files use generated UUID filenames and are never exposed through a static directory listing.

* Optional Cloudinary: set `CLOUDINARY_URL` on the API and omit `LOCAL_MEDIA_DIR` to use the provider. Verification images use authenticated assets; they have no public URL in the database. Owner/admin reads return a short-lived signed download URL. Admin reads require a reason and audit entry. Vehicle and profile photos require review before appearing on tourist cards.
* Firebase API: set `GOOGLE_APPLICATION_CREDENTIALS` to a local service-account JSON file. With Compose, use a local override to mount that file read-only and set its **container** path. Do not put credentials in the image or repository. The worker sends generic messages with resource IDs, retries failed/unavailable rows with backoff, and retains the inbox even after retry exhaustion.
* Firebase Android: create an Android Firebase app for `lk.rentmate.rentmate`. Supply its Firebase configuration with `--dart-define=FIREBASE_API_KEY=...`, `FIREBASE_APP_ID`, `FIREBASE_PROJECT_ID` and `FIREBASE_SENDER_ID` (see mobile startup). Firebase client identifiers are configuration, not server authorization credentials. Notification permission is requested on supported Android versions. Without configuration, the app explicitly shows that push is unavailable.

## Product rules

Tourists choose agents; they cannot list drivers. The API checks roles, approval, ownership, membership and vehicle matching. Tourist-facing responses never contain driver phone, payout or commission. Driver-facing responses never contain quote/deposit/commission. The collection exception reveals only the per-trip collection and handover amounts. Tourist contact is released explicitly by the agent. Send is audited and idempotent. Reopen preserves assignment history and revokes the previous driver's details. Read-only offline caches contain route/status summaries, no contact data or documents; logout clears them. A disconnected device cannot receive a revocation until it reconnects.

All money uses integer LKR minor units (e.g. `2000000` = LKR 20,000.00). No payment gateway, map, tracking, chat or bidding is included.

## Documentation

* `docs/PROPOSAL_AUDIT.md` — gaps corrected and outstanding proposal acceptance.
* `docs/DEVELOPMENT_STATUS.md` — source audit and current implementation.
* `docs/REQUIREMENTS_TRACEABILITY.md` — FR/NFR/US/screen coverage and evidence.
* `docs/ARCHITECTURE.md` — transactions, privacy and caching.
* `docs/IMPLEMENTATION_PLAN.md` — decisions and remaining work.
* `docs/openapi.json` — import into Swagger Editor or Postman.
* `docs/RentMate.postman_collection.json` — endpoint collection; request schemas are in OpenAPI.
* `docs/DEMO_WALKTHROUGH.md` — demonstrator setup and full workflow.
* `docs/TEST_RESULTS.md` — actual verification results and limitations.
* `docs/evaluation/README.md` — real-device, task observation and SUS evaluation templates/scorer.

Source folders are `backend/`, `mobile/`, `scripts/` and `.github/workflows/`. No Git remote was present in the supplied workspace; push, PR reviews and hosted CI execution require the student team's repository.
