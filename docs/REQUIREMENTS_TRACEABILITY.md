# Requirements traceability

Source: official Group 30 proposal, Tables 7.1, 7.2, 8.1, 9.1, 10.2, 13.1 and Appendices B–D. Audited 18 October 2026. Initial workspace: all requirements missing. The user subsequently requested a local database file; SQLite and local image storage now work without service accounts, while the proposal's PostgreSQL/Cloudinary options remain. This matrix distinguishes implementation from acceptance evidence.

Status key: **implemented** = connected source and database behavior exist; **verified** = listed automated acceptance evidence passed; **partial** = part remains unverified or incomplete; **blocked** = external input/service/device required. A requirement's full definition of done also requires applicable UI/service/device acceptance; backend-only verification is explicitly labeled.

| ID | Requirement | Status and evidence | Implementation |
|---|---|---|---|
| FR-01 | Register/login | verified API + widget validation; secure device persistence implemented | `backend/src/app.js`, `mobile/lib/state.dart`, `main.dart` |
| FR-02 | Role access | verified API ownership/role denials + four-role navigation widgets | `app.js`, `domain.js`, `home.dart` |
| FR-03 | Driver/vehicle profile | implemented; local image upload/persistence and restricted viewing verified; Cloudinary provider option unverified | `app.js`, `media.js`, `local-media.js`, `profile.dart` |
| FR-04 | Account verification | implemented; approval/suspension and local document access/review API verified; device walkthrough pending | `admin.js`, `profile.dart` |
| FR-05 | Public profile | implemented; actual reputation queries; contact omission verified | `domain.js`, `ui.dart` |
| FR-06 | Join agency | verified API; discovery/application UI connected | `app.js`, `home.dart` |
| FR-07 | Manage drivers | verified membership/ownership API and vehicle/privacy response; mobile vehicle information and accept/reject/remove tested | `app.js`, `home.dart` |
| FR-08 | Browse agents | verified response and mobile browsing widget | `/agents`, `AgentsPage` |
| FR-09 | Request tour | verified API and mobile form submission | `tours.js`, `requestTour` |
| FR-10 | Quote/accept/decline | verified API; connected quote forms/actions | `tours.js`, `tour.dart` |
| FR-11 | Change request | verified API clears acknowledgment; structured review UI connected | `changes`, `tour.dart` |
| FR-12 | Post tour | verified quote/state/money guards; post form connected | `tours.js`, `tour.dart` |
| FR-13 | Targeted push | partial; VAN/KDH matching and inbox recipients verified; real FCM blocked on credentials | `domain.js`, `push.js` |
| FR-14 | Interest/overlap warning | verified API and direct feed action for one matching vehicle; multiple-vehicle picker and explicit overlap dialog connected | `tours.js`, `trip_actions.dart` |
| FR-15 | Select driver | verified SQLite and PostgreSQL concurrent HTTP selections: one 200, one 409, one active row; selection widget verified | `tours.js`, partial unique index, `DriverSelection` |
| FR-16 | Confirm and Send | verified API idempotency/privacy/audit; money summary, two previews and default-off phone toggle tested in Flutter | `domain.js`, `SendPage` |
| FR-17 | Reopen | verified replacement scenario: old driver 404, old tourist card removed, history retained | `tours.js` |
| FR-18 | Withdraw | verified urgent inbox, phone revocation and replacement flow; mobile reason form | `tours.js`, `tour.dart` |
| FR-19 | Start/complete | verified acknowledgment/state rules and notifications; mobile actions connected | `tours.js`, `tour.dart` |
| FR-20 | Money records | implemented; settlement amounts and two-party confirmation verified; deposit and event history persisted | `tours.js`, `settlement_events`, `tour.dart` |
| FR-21 | Ratings/reputation | verified completion/targets/duplicate prevention and actual cancellation aggregates; own history and counters displayed; revoked route snapshot/privacy verified | `domain.js`, `tours.js`, `history.dart`, `profile.dart` |
| FR-22 | Notification inbox | verified own-only list/read and destination metadata; tour navigation widget tested; push-tap handling implemented, real Firebase delivery pending | `app.js`, `NotificationsPage`, `main.dart` |
| FR-23 | Audit log | verified Send/revoke/admin access reasons; admin audit UI connected | `audit_logs`, `admin.js`, `media.js` |
| FR-24 | Offline viewing | verified cache allowlist/account separation/clear-on-logout and offline widget; read-only saved detail connected; airplane-mode device test remains | `state.dart`, Hive, `OfflineTripPage` |

| ID | Quality target | Status and remaining acceptance |
|---|---|---|
| NFR-01 | ≤5 taps posting/Send; SUS ≥68 | partial; compact actions implemented; real observation/SUS pending; templates/scorer provided, empty sample correctly reports not accepted |
| NFR-02 | ≥90% main API calls <2 s | partial; 20 local list calls passed; mobile-network/deployed workload unmeasured |
| NFR-03 | Hashed passwords/expiring tokens | verified bcrypt hash, wrong password, forged/expired JWT, logout and suspension invalidation |
| NFR-04 | Server role/ownership/privacy | verified T-04–T-07, membership and cross-agency denials, release/revocation |
| NFR-05 | Restricted documents/minimization | verified local owner/admin/expiry/session-revocation/no-store delivery and audit; Cloudinary provider option unverified |
| NFR-06 | Single assignment | verified simultaneous HTTP selections on native PostgreSQL row locks and SQLite serialized write transactions; partial unique index on both |
| NFR-07 | Read-only offline + banner | verified widget/state behavior; physical airplane-mode test pending |
| NFR-08 | Android 8+ on 3 devices | partial; API 26 minimum configured; three-device execution pending |
| NFR-09 | Modular/reviewed/documented | partial; modules, OpenAPI, Postman and CI authored; hosted PR/peer review requires remote repository |
| NFR-10 | Indexed migration-based schema | verified SQLite and PostgreSQL migrations applied twice; SQLite file reopens with persisted data and failed work rolls back |
| NFR-11 | English resources | implemented; product labels/validation in `mobile/assets/strings.json`; API errors remain server English |

| User stories | Coverage | Remaining acceptance |
|---|---|---|
| US-01 | Profile, licence, vehicle and photo forms; pending workflow; local upload/delivery verified | Device upload/review walkthrough |
| US-02–03 | Discovery, membership application/decision/status | Device walkthrough |
| US-04–06 | Agent browsing, request, quote/response | Full device walkthrough |
| US-07–10 | Payout-only feed, interest, atomic selection, two-card release | Real FCM delivery and device Send |
| US-11–12 | Withdrawal, audited reopen and replacement | Device walkthrough |
| US-13–14 | Change review, re-acknowledgment, start/complete | Device walkthrough |
| US-15–16 | Rating targets, reputation, deposit/settlement/history | Device walkthrough |
| US-17–18 | In-app queue, reason-gated full details, local private documents, verification, audit | Device document review walkthrough |

| Screen | Flutter implementation | Status |
|---|---|---|
| S-01 | `AuthPage`, connected `DataForm` | implemented; widget tested |
| S-02 | `AgentsPage` (tourist) | implemented; widget tested |
| S-03 | `requestTour` | implemented; real form submission widget tested |
| S-04 | `TourPage` tourist branch | implemented; API privacy verified |
| S-05 | `ToursPage` agent role, status filters, server totals, pending applications and unread counts | implemented |
| S-06 | Post form in `TourPage` | implemented |
| S-07 | `DriverSelection` | implemented; widget tested |
| S-08 | `SendPage` | implemented; money/previews/default-off release widget and API verified |
| S-09 | `MembershipPage` agent | implemented; vehicle review/decision widget verified |
| S-10 | `AgentsPage` driver + application-status page | implemented |
| S-11 | `ToursPage` driver | implemented; agency filter and direct interest; list/action widget tested |
| S-12 | `TourPage` driver branch | implemented; API lifecycle verified |
| S-13 | `ProfilePage`, `VehiclesPage`, `HistoryPage`, own media and ratings | implemented; local upload/delivery API and history widget tested |
| S-14 | `NotificationsPage` | implemented; inbox navigation widget tested; FCM delivery blocked |
| S-15 | `AdminPage`, `AdminDetails`, `AuditPage`, `AdminTripDetails` | implemented; local private review API verified; device walkthrough pending |

T-01–13 and T-15 have automated backend coverage in `backend/tests/workflow.test.js`. T-14 has state/widget coverage and awaits airplane-mode hardware verification. The proposal's separate interview, SUS and contribution evaluations require human participants and team review.
