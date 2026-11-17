# Proposal audit — 18 October 2026

The proposal is not yet fully accepted. The earlier traceability matrix described connected code more generously than its acceptance evidence justified. This audit checks the actual API, Flutter workflows, persistence and tests against FR-01–24, NFR-01–11, US-01–18, S-01–15, Table 10.2 and Appendices B–D.

## Gaps identified in code

1. FR-07 / S-09: membership review omitted the driver's vehicle information.
2. FR-16 / S-08: Confirm and Send omitted the agent's total/deposit/payout/commission money box.
3. FR-14 / US-08 / S-11: interest required opening details and selecting a vehicle even for one eligible vehicle; no feed action existed.
4. FR-21 / S-13: own reputation counters and historical withdrawn/cancelled assignments had no complete mobile presentation. Agent cancellation counts were always zero.
5. FR-22: inbox taps only marked records read; push taps had no destination handling and resource types were ambiguous.
6. FR-24: the offline cache held appropriate route/status details, but tapping a saved trip only produced a blocking dialog.
7. FR-16/privacy: public driver cards unnecessarily included the driver's free-form biography; contact could be re-released after withdrawal.
8. Acceptance coverage lacked direct Send preview, membership vehicle privacy, duplicate interest, notification destination and offline detail tests.

All eight listed code gaps were corrected. Further inspection added explicit historical route snapshots, blocked contact re-release after withdrawal, improved non-JSON/session error handling, and removed the debug-key fallback from release builds. PostgreSQL migrations 004–005 preserve notification destinations and assignment history without resetting data.

Per the user's instruction, local mode now uses `.local/rentmate.db` and `.local/media/`. Startup creates schema/configuration automatically and seeds only a new empty database with fictional accounts and random passwords. Restart preserves records. The existing PostgreSQL implementation remains available. Local image upload/review works without Cloudinary; private views expire, require current owner/admin permissions and audit administrative reasons. This is an authorized deployment alternative to the proposal's cloud/database setup, not a claim that Cloudinary itself has been tested.

Verification: **25 backend tests passed on SQLite and 25 on native PostgreSQL** (the same six suites, including three SQLite/local-storage tests). Flutter's **17 tests passed**, its analyzer reported no issues, and an Android debug APK was built. Live API health and login/profile reads succeeded for all five persisted demo accounts. Detailed reports are in TEST_RESULTS.md; individual requirements are mapped in REQUIREMENTS_TRACEABILITY.md.

## Acceptance that code cannot establish alone

Real Firebase delivery requires a configured Firebase project. Cloudinary is an optional provider whose success has not been tested; local media storage is operational and tested. NFR-08 still requires execution on at least three Android devices/emulators including API 26. NFR-01 requires observed tap counts and SUS responses from at least 10 participants. Templates and a validated scorer are in `docs/evaluation/`; the actual empty sample reports `MORE_PARTICIPANTS_REQUIRED`. NFR-09 requires the student team's remote repository and peer-reviewed pull requests. Release signing requires the owner's keystore. These outstanding acceptance items mean the proposal cannot honestly be marked 100% fulfilled.
