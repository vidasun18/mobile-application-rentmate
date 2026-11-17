const admin = require("firebase-admin");
async function deliverPush(db, logger) {
  const enabled = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (enabled && !admin.apps.length)
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  await db.transaction(async (c) => {
    const rows = (
      await c.query(
        "SELECT * FROM notifications WHERE push_status IN ('PENDING','UNAVAILABLE','FAILED') AND next_push_at<=now() AND push_attempts<8 ORDER BY next_push_at LIMIT 30 FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const n of rows) {
      let status = "UNAVAILABLE";
      if (enabled) {
        const tokens = (
          await c.query("SELECT token FROM push_tokens WHERE user_id=$1", [
            n.user_id,
          ])
        ).rows.map((x) => x.token);
        if (tokens.length) {
          try {
            // No private data, free-form notes, prices or commission in push payloads.
            const r = await admin.messaging().sendEachForMulticast({
              tokens: tokens.slice(0, 500),
              notification: { title: "RentMate", body: n.title },
              data: {
                resource_id: n.resource_id || "",
                notification_id: n.id,
                resource_kind: n.resource_kind,
              },
            });
            status = r.failureCount === 0 ? "DELIVERED" : "FAILED";
            for (let i = 0; i < r.responses.length; i++)
              if (
                [
                  "messaging/registration-token-not-registered",
                  "messaging/invalid-registration-token",
                ].includes(r.responses[i].error?.code)
              )
                await c.query("DELETE FROM push_tokens WHERE token=$1", [
                  tokens[i],
                ]);
          } catch (error) {
            status = "FAILED";
            logger?.warn({ code: error.code }, "Push delivery failed");
          }
        }
      }
      await c.query(
        "UPDATE notifications SET push_status=$2,push_attempts=push_attempts+1,next_push_at=now()+interval '5 minutes' WHERE id=$1",
        [n.id, status],
      );
    }
  });
}
module.exports = { deliverPush };
