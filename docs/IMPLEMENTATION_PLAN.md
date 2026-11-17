# Implementation plan

1. Foundation: PostgreSQL schema, configuration, migration runner, structured errors, authentication.
2. Accounts: role and approval guards, profiles, vehicles, membership, audited administration.
3. Tours: quotes, acceptance, matching feed, transactional assignment, audited release/revocation, lifecycle and money records.
4. Mobile: Material 3 role navigation and connected forms/cards, secure sessions, Hive summaries and notification inbox.
5. Hardening: complete integration flows, privacy, races, mobile analyzer/tests, Android build, setup and API documentation.

## Decisions reconciled with the proposal

* The ER diagram permits multiple agency memberships per driver. Every feed, interest and selection checks the appropriate accepted membership.
* VAN requests match VAN or KDH vehicles (T-09). CAR and KDH requests otherwise require the requested category and enough seats.
* Figure 10.2 allows either owning tourist or agent to cancel at any point before departure, including ASSIGNED. Completed/cancelled tours have no reopening transition.
* Withdrawal leaves ASSIGNED until the owning agent reopens; it immediately revokes phone sharing. Reopen removes all prior interests and the active assignment, preserves history, hides the old tourist card and blocks the previous driver's tour-detail access.
* A change request is free text; an agent's approval supplies structured pickup/time updates. Approval clears the assigned driver's acknowledgment. They must acknowledge again before starting.
* Commission is derived from immutable accepted quote and payout rather than stored redundantly as in the draft ER diagram. Money is exact integer LKR minor units, capped within JavaScript's safe integer range. The collection/handover exception follows Table 10.2 and Appendix B.
* Deposit receipt is a separate audited agent record, since the MVP does not process payments. Settlement amount follows the agreed collector/payout and each party confirms once.
* A revoked driver is excluded from that tour's detail/feed even if otherwise eligible; matching drivers still receive generic reopening notifications. An agent selects a different eligible driver. This conservative rule prevents the old driver regaining access through the open feed.
* Sensitive cache contents are reduced to route/status summaries with a saved read-only detail page. Contacts and documents are fetched online. Ended driver history uses a frozen route snapshot, so changes after reassignment do not reveal a new pickup.
* Per the user's 18 October instruction, SQLite file storage and local image files provide a complete local development mode. PostgreSQL and Cloudinary remain optional adapters. Both database schemas and the full HTTP workflow suite are maintained.

No Phase 2 features are included. Code gaps from the proposal audit are corrected. Real Firebase delivery, device/usability acceptance, release signing and team repository review remain delivery gates after automated verification.
