# Test results — updated 19 October 2026

## 19 October: separate Android host APK built

The new `server-android/` project and `backend/scripts/phone-server.js` implement phone hosting. The full Gradle build succeeded: Java compilation against SDK 36 and native linking for arm64-v8a, armeabi-v7a and x86_64. Both JUnit archive-containment tests passed in Gradle with zero failures/errors. The direct storage check passed six checks (administrator creation, password hashing, rollback, reopen, preserved credentials and network-relative media). The prepared payload contains 239 production packages and its bootstrap passed against a separate real file database.

The latest approved full SQLite HTTP regression run **passed all 28 tests in seven suites** (14.11 seconds), including the three phone-server integration tests. The report is `docs/sqlite-test-results.json`. These verify phone administrator login/client registration, preserved database/credentials and JWT validity across restart, private stop control, denied HTTP access to configuration and distinct credentials for independent phones. Local image links also follow the client's current Wi-Fi/hotspot address. Earlier restricted attempts failed Jest initialization/loopback access, and earlier approval reviews failed or timed out; those attempts are not counted as test runs.

The full Android runtime download completed and its SHA-256 matches both the user-supplied SHA256SUMS and the published release entry: `9b068f4ad4c755f26c04b31883c536f037a4831e6575847a699cdf5fa72dde25`. The local ZIP is `.local/android-runtime/nodejs-mobile-android-24.22.0-0.zip`, 112,769,022 bytes; archive inspection confirms headers and arm64-v8a/armeabi-v7a/x86_64 libraries.

The user subsequently provided both files in `Downloads/dp`; checksum verification passed again. Approval execution recovered. An initial build exposed an incorrect recipe-only license URL (404); the script now obtains the complete license from the exact patched runtime tag, validates it and records its source/hash. The offline Gradle build then **succeeded in 1m 31s, 48 tasks executed** using JDK 21, AGP 9.1.0, Gradle 9.3.1, NDK 28.2.13676358 and CMake 3.22.1.

Artifact: **`deliverables/RentMate-server-debug.apk`**, application ID **`lk.rentmate.server`**, version **0.1.0 (1)**, **301,579,969 bytes**, SHA-256 **`BA087984685DAAE66734B6525E73839D6237C41723D9FDB344394E1D382DB9D4`**. Manifest inspection confirms min SDK 26, target SDK 36, the three ABIs and required foreground-service/network permissions. APK v2 signature and 16 KB ZIP alignment checks pass. Each Node library has ELF LOAD alignment of at least 16 KB. The APK includes the JNI bridge/C++ runtime for every ABI and the 239-package payload; inspection found the license and no private database/configuration/account files. Machine-readable results are in `phone-server-build-results.json`.

ADB lists no attached debugging device. Service startup/background/screen-off behavior, backup UI and two-phone/hotspot use remain **on-device acceptance tasks**; compilation and host API tests do not verify them. See `PHONE_SERVER_SETUP.md`. The runtime remains a third-party preview as documented in `server-android/README.md`. Earlier client and PostgreSQL results below retain their original scope and dates.

## 19 October: physical-phone connection fix

* Diagnosed the old APK's emulator-only API address. The running laptop API responds at `http://10.55.155.44:3000`; the user confirmed `/health` in the phone browser. The existing generated admin credentials successfully logged in through the API. No password, database or firewall changes were made.
* Added Server connection/Test connection, persistent settings, accurate signed-out network errors and per-server session/cache isolation. Seven new state/widget regression tests cover validation, failed health checks, restart/logout persistence, old-session rejection, a delayed-login race and the Sign in → server setting → admin login journey.
* **24 Flutter tests passed; analyzer: no issues.** The Android debug build succeeded. Backend behavior is unchanged; the 18 October backend suite results below remain its latest full run.
* New physical-phone artifact: **`deliverables/RentMate-phone-debug.apk`**, version **0.1.1 (2)**, **160,739,619 bytes**, SHA-256 `CD025D28C0B9812A8BBA328BC3B9770503FDBE5D027EEF8424AD8524837180EA`. Built with `API_URL=http://10.55.155.44:3000`. Manifest inspection confirms `lk.rentmate.rentmate`, min SDK 26, target SDK 36, arm64-v8a/armeabi-v7a/x86_64. The earlier emulator APK remains separate.
* The phone app could not be installed through ADB because no debugging device is attached. Browser reachability is confirmed; installation and administrator login in the rebuilt APK still need the user's phone check. See PHONE_CONNECTION.md.

## 18 October: executed verification

| Check | Actual result | Scope |
|---|---|---|
| SQLite/Jest | **25 passed, 0 failed**, 6 suites | Real isolated file database; full workflow/privacy/concurrency; file persistence/rollback and local media |
| Native PostgreSQL/Jest | **25 passed, 0 failed**, 6 suites | Same workflow suite on PostgreSQL; SQLite/local-file tests also run as separate fixtures |
| Flutter state/widget tests | **17 passed, 0 failed** in final formatted-source run | Role navigation, validation, request submission, selection, direct interest, Send money/privacy, membership vehicles, history, inbox navigation, offline/retry/error states and three welcome layout widths |
| Flutter analyzer | **No issues found** | Final formatted source |
| Android debug APK | **Built successfully** | Final-source incremental build also passed |
| Runtime npm audit | **0 vulnerabilities** | `npm audit --omit=dev` |
| Complete npm audit | Prior run reported 19 moderate development-dependency advisories | No forced downgrade applied; latest refreshed check covered runtime dependencies only |
| Local list performance | **≥18/20 requests under 2 seconds**, both database runs | Automated 90% target for local list calls; in-process Supertest HTTP, not cellular or deployed load |
| Live local API | **Health and five role logins/profile reads passed** | Real localhost listener, persistent demo IDs, restart without reseeding or replacing credentials |
| Docker Compose | **Configuration syntax passed** | Daemon was stopped; container launch not verified |
| Android emulator | API 37 / Android 17 AVD startup failed to complete | Initial install could not reach Android's activity service; no app launch claim |

Machine-readable Jest reports are `backend-test-results.json` (PostgreSQL) and `sqlite-test-results.json`; `local-smoke-results.json` records the live health/login checks after API restart without credentials or tokens. The native PostgreSQL workflow used PostgreSQL 18.4 with separate pooled connections. The SQLite workflow used Node 24.18.1 / SQLite 3.53.1 and a real isolated file with serialized write transactions. These are the same 25 tests run with each database configuration, not 50 distinct test cases. Each concurrent-selection test issued simultaneous HTTP requests, asserted one success and one conflict, and queried one active assignment. Migrations ran twice without reset. SQLite-specific fixtures additionally checked persistence after closing/reopening, rollback on foreign-key failure and transaction ordering.

`screenshots/welcome-widget.png` is a visually inspected Flutter widget rendering with SDK Roboto/Material Icons fonts, not an Android device capture. Its layout test passes at 320, 432 and 800 logical-pixel widths.

Final debug artifact: `deliverables/RentMate-debug.apk`, **182,799,635 bytes**. SHA-256: `045D284A62CDCE0717E31CE23B3EECF6927DAA813F333091AB2C2F88FD019E97`. Built with `API_URL=http://10.0.2.2:3000` for a Windows-hosted API and Android emulator. This is a debug-signed testing APK. Release builds now refuse missing user-keystore configuration. Gradle emitted a Firebase Kotlin plugin migration warning; the debug build succeeded.

## Acceptance checks covered

* Pending registration, unique emails, prohibited admin self-registration, bcrypt storage, wrong passwords, forged/expired JWTs, logout and suspension invalidation.
* Server role/ownership checks, private document owner/admin guards, mandatory admin reasons, and cross-agency denials.
* VAN/KDH targeting, approved vehicle and membership feed checks, interest/overlap warning and all 64 lifecycle state pairs.
* Request → quote → accept → post → concurrent selection → idempotent Send → change review → renewed driver acknowledgment → start → complete → ratings and two-party settlement.
* No tourist driver card before Send; no tourist phone by default; no driver commission/quote; no tourist payout/driver phone. The collection exception exposes only the agreed handover fields.
* Withdrawal, reasoned reopen, phone revocation, old driver 404, tourist card removal and replacement assignment with historical rows retained.
* Offline summary allowlist, account separation, logout cache clearing, visible offline banner, saved read-only detail page and session cleanup after empty/non-JSON 401 responses. Full contact/document details remain online-only.
* Membership vehicle details without identity documents; direct one-vehicle feed interest; duplicate interest without duplicate notification; private Send money summary and default-off contact release.
* Revoked driver history freezes the old route and omits later pickup changes. Actual agent cancellations populate reputation. Notifications carry typed destinations and the inbox opens its associated tour.
* Local JPEG/PNG file upload/persistence; document owner/admin-only links; mandatory admin reason/audit; expiry, session revocation, no-store responses; public-photo approval and owner-status checks. Invalid image bytes are rejected. Pending photo review has an explicit private View action.
* Different trip time-zone offsets normalize to UTC before persistence and interval comparison.
* Development seed persists fictional fixtures, generates distinct random passwords and rolls back duplicate seeding without resetting records.

## Failures found and fixed

Initial test launches exposed Windows PostgreSQL process/permission constraints; the final runner uses `pg_ctl`, UTF-8 and isolated ignored cluster directories. Invalid generated test email addresses were corrected. Mobile tests found refresh callbacks that returned a Future from `setState`; fixed in lists and trip detail. Stable form field keys fixed test interaction with lazily built date inputs. Analyzer brace fixes were applied after formatting. None of those failed runs are presented as passes.

## Not verified

Real Firebase delivery and notification permission/background behavior need service configuration and a device run. The optional Cloudinary provider's upload/authenticated download is unverified; local file delivery works and is tested. Three-device compatibility including Android 8, airplane-mode hardware behavior, release distribution, hosted CI/peer review and real-user tap measurements remain pending. The actual SUS response file is empty; the scorer reports zero participants, null average and `MORE_PARTICIPANTS_REQUIRED`. Scorer unit fixtures are synthetic tests only. No production/mobile-network or human usability success is claimed. The three widget layout widths do not count as three Android devices.

## Exact next acceptance task

Use `npm.cmd run local`, the generated account file and the APK to perform the full walkthrough on API 26 plus two current Android devices/emulators. Record local upload/review, airplane-mode/cache clearing and role flows in `docs/evaluation/devices.csv`. Configure Firebase only when real push delivery is required. Collect real task observations and ten SUS responses using the provided templates and scorer. Supply the team's remote repository for hosted CI and peer review.
