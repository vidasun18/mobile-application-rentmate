# Proposal acceptance workbook

No participant responses or device results have been fabricated. Keep participant identities separate from this repository; use anonymous IDs and obtain consent before observing tasks.

Use `task-observations.csv` for real task observations, `devices.csv` for at least three actual Android devices/emulators (including API 26), and `sus-responses.json` for actual 1–5 responses to the standard ten-item SUS questionnaire. Empty templates are not evidence of successful evaluation.

Observe tourist request/quote acceptance/rating; agent post/selection/Send/reopen; driver application/interest/acknowledgment/start/complete. Count posting and Send taps only after fields are filled, including confirmation steps. The target is at most five taps for each task. Test airplane mode after loading tours; verify saved details remain read-only and that logout removes the cache. Reconnect after a revocation and verify the previous driver cannot reopen the live details.

Collect at least ten participants' SUS responses. Each record needs `participant_id`, `role` (TOURIST/AGENT/DRIVER/ADMIN), and integers `q1` through `q10`. Run from backend:

```powershell
node scripts/evaluate-usability.js ../docs/evaluation/sus-responses.json
```

The scorer reports the average, the sample-size criterion and the score criterion separately. It refuses incomplete/out-of-range responses and never treats a missing sample as a passing result. The proposal's target is an average of at least 68 with at least ten participants.

Scoring reference: [Lewis, The System Usability Scale: Past, Present, and Future](https://www.researchgate.net/publication/324116412_The_System_Usability_Scale_Past_Present_and_Future). Use the standard questionnaire; this repository does not invent replacement questions or substitute automated tests for participant feedback.

Use Appendix A of the supplied proposal to interview real agents/drivers. Record anonymized findings, dates, consent and any resulting product decisions in a separate team report. Team contribution history and reviewed pull requests require the actual student team's remote repository.
