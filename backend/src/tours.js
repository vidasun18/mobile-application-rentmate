const { randomUUID } = require("node:crypto");
const { requireThat } = require("./errors");
const { uuid } = require("./validation");
const D = require("./domain");
module.exports = (app, { db, ok, parse, roles, approved }) => {
  // Every tour mutation takes the same row lock; checks and audit/inbox writes commit together.
  const mutate = (role, schema, fn) => [
    roles(...role),
    approved,
    async (req, res) => {
      uuid.parse(req.params.id);
      const b = schema ? parse(schema, req.body) : {};
      const result = await db.transaction(async (c) => {
        const t = (
          await c.query("SELECT * FROM tours WHERE id=$1 FOR UPDATE", [
            req.params.id,
          ])
        ).rows[0];
        requireThat(
          t && (await D.accessible(c, req.user, t)),
          404,
          "NOT_FOUND",
          "Tour not found",
        );
        const out = await fn(c, t, b, req);
        await c.query("UPDATE tours SET updated_at=now() WHERE id=$1", [t.id]);
        return out || { saved: true };
      });
      ok(res, result);
    },
  ];
  const state = async (c, t, status, user, reason = "") => {
    D.transition(t, status);
    await c.query("UPDATE tours SET status=$2 WHERE id=$1", [t.id, status]);
    await D.audit(c, user.id, "TOUR_" + status, t.id, reason, {
      from: t.status,
    });
  };
  const assigned = async (c, t, u) => {
    const a = await D.activeAssignment(c, t.id);
    requireThat(
      a?.driver_id === u.id,
      404,
      "NOT_FOUND",
      "Assignment not found",
    );
    return a;
  };
  const participants = async (c, t, title) => {
    await D.notify(c, t.tourist_id, title, t.id);
    await D.notify(c, t.agent_id, title, t.id);
  };
  app.get(
    "/tours",
    roles("TOURIST", "AGENT", "DRIVER"),
    approved,
    async (req, res) => {
      let rows;
      if (req.user.role === "DRIVER")
        rows = (
          await db.query(
            `SELECT t.* FROM tours t WHERE
      EXISTS(SELECT 1 FROM assignments a WHERE a.tour_id=t.id AND a.driver_id=$1 AND a.ended_at IS NULL) OR
      (t.status IN ('OPEN','ASSIGNED') AND NOT EXISTS(SELECT 1 FROM assignments old WHERE old.tour_id=t.id AND old.driver_id=$1)
       AND EXISTS(SELECT 1 FROM memberships m JOIN vehicles v ON v.driver_id=m.driver_id JOIN users agent ON agent.id=m.agent_id
       WHERE m.driver_id=$1 AND m.agent_id=t.agent_id AND m.status='ACCEPTED' AND agent.status='APPROVED' AND v.approved=true
       AND v.seats>=t.passengers AND (v.type=t.vehicle_type OR (t.vehicle_type='VAN' AND v.type='KDH'))))
       ORDER BY t.created_at DESC LIMIT 100`,
            [req.user.id],
          )
        ).rows;
      else
        rows = (
          await db.query(
            `SELECT * FROM tours WHERE ${req.user.role === "AGENT" ? "agent_id" : "tourist_id"}=$1 ORDER BY created_at DESC LIMIT 100`,
            [req.user.id],
          )
        ).rows;
      const out = [];
      for (const row of rows) {
        const item = await db.transaction(async (c) => {
          const t = (
            await c.query("SELECT * FROM tours WHERE id=$1 FOR SHARE", [row.id])
          ).rows[0];
          return t && (await D.accessible(c, req.user, t))
            ? D.serializeTour(c, req.user, t)
            : null;
        });
        if (item) out.push(item);
      }
      ok(res, out);
    },
  );
  app.get(
    "/tours/:id",
    roles("TOURIST", "AGENT", "DRIVER"),
    approved,
    async (req, res) => {
      uuid.parse(req.params.id);
      const out = await db.transaction(async (c) => {
        // A coherent snapshot prevents a concurrent reopen from releasing revoked data.
        const t = (
          await c.query("SELECT * FROM tours WHERE id=$1 FOR SHARE", [
            req.params.id,
          ])
        ).rows[0];
        requireThat(
          t && (await D.accessible(c, req.user, t)),
          404,
          "NOT_FOUND",
          "Tour not found",
        );
        return D.serializeTour(c, req.user, t);
      });
      ok(res, out);
    },
  );
  app.post("/tours", roles("TOURIST"), approved, async (req, res) => {
    const b = parse("request", req.body);
    const tour = await db.transaction(async (c) => {
      requireThat(
        (
          await c.query(
            "SELECT id FROM users WHERE id=$1 AND role='AGENT' AND status='APPROVED' FOR SHARE",
            [b.agent_id],
          )
        ).rows.length,
        404,
        "NOT_FOUND",
        "Verified agent not found",
      );
      const t = (
        await c.query(
          `INSERT INTO tours(id,tourist_id,agent_id,pickup,destination,starts_at,ends_at,vehicle_type,passengers,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            randomUUID(),
            req.user.id,
            b.agent_id,
            b.pickup,
            b.destination,
            b.starts_at,
            b.ends_at,
            b.vehicle_type,
            b.passengers,
            b.notes,
          ],
        )
      ).rows[0];
      await D.audit(c, req.user.id, "TOUR_REQUESTED", t.id);
      await D.notify(c, t.agent_id, "A new tour request arrived", t.id);
      return D.serializeTour(c, req.user, t);
    });
    ok(res, tour, 201);
  });
  app.post(
    "/tours/:id/quote",
    ...mutate(["AGENT"], "quote", async (c, t, b, req) => {
      D.transition(t, "QUOTED");
      await c.query(
        "UPDATE quotes SET status='SUPERSEDED' WHERE tour_id=$1 AND status='PENDING'",
        [t.id],
      );
      await c.query(
        "INSERT INTO quotes(id,tour_id,total_minor,deposit_minor,terms,currency) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          t.id,
          b.total_minor,
          b.deposit_minor,
          b.terms,
          b.currency,
        ],
      );
      await state(c, t, "QUOTED", req.user);
      await D.notify(c, t.tourist_id, "Your tour quote is ready", t.id);
    }),
  );
  app.post(
    "/tours/:id/accept",
    ...mutate(["TOURIST"], "accept", async (c, t, b, req) => {
      requireThat(
        t.status === "QUOTED",
        409,
        "QUOTE_STATE",
        "A pending quote is required",
      );
      const q = (
        await c.query(
          "SELECT * FROM quotes WHERE tour_id=$1 AND status='PENDING' FOR UPDATE",
          [t.id],
        )
      ).rows[0];
      requireThat(q, 409, "QUOTE_STATE", "No pending quote");
      await c.query("UPDATE quotes SET status=$2 WHERE id=$1", [
        q.id,
        b.accept ? "ACCEPTED" : "DECLINED",
      ]);
      await state(
        c,
        t,
        b.accept ? "ACCEPTED" : "CANCELLED",
        req.user,
        b.accept ? "" : "Quote declined",
      );
      await D.notify(
        c,
        t.agent_id,
        b.accept ? "Tour quote accepted" : "Tour quote declined",
        t.id,
      );
    }),
  );
  app.post(
    "/tours/:id/post",
    ...mutate(["AGENT"], "post", async (c, t, b, req) => {
      D.transition(t, "OPEN");
      requireThat(
        t.status === "ACCEPTED",
        409,
        "QUOTE_REQUIRED",
        "Only an accepted quote may be posted",
      );
      const q = (
        await c.query(
          "SELECT * FROM quotes WHERE tour_id=$1 AND status='ACCEPTED'",
          [t.id],
        )
      ).rows[0];
      requireThat(
        q && BigInt(b.payout_minor) <= BigInt(q.total_minor),
        422,
        "MONEY_RANGE",
        "Payout cannot exceed accepted total",
      );
      requireThat(
        BigInt(b.collection_minor) <=
          BigInt(q.total_minor) - BigInt(q.deposit_minor),
        422,
        "MONEY_RANGE",
        "Collection cannot exceed the remaining balance",
      );
      requireThat(
        b.collector !== "DRIVER" || b.collection_minor >= b.payout_minor,
        422,
        "MONEY_RANGE",
        "Driver collection must cover the payout",
      );
      requireThat(
        new Date(t.starts_at) > new Date(),
        422,
        "PAST_TOUR",
        "Cannot post a past tour",
      );
      await c.query(
        "UPDATE tours SET payout_minor=$2,collector=$3,collection_minor=$4,instructions=$5 WHERE id=$1",
        [t.id, b.payout_minor, b.collector, b.collection_minor, b.instructions],
      );
      await state(c, t, "OPEN", req.user);
      await D.notifyMatching(c, t);
    }),
  );
  app.post(
    "/tours/:id/deposit",
    ...mutate(["AGENT"], "accept", async (c, t, b, req) => {
      requireThat(
        ["ACCEPTED", "OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED"].includes(
          t.status,
        ),
        409,
        "QUOTE_REQUIRED",
        "An accepted quote is required",
      );
      await c.query("UPDATE tours SET deposit_received=$2 WHERE id=$1", [
        t.id,
        b.accept,
      ]);
      await D.audit(
        c,
        req.user.id,
        "DEPOSIT_RECORD_UPDATED",
        t.id,
        "Agent recorded deposit status",
        { received: b.accept },
      );
      await D.notify(c, t.tourist_id, "Your deposit record was updated", t.id);
    }),
  );
  app.post(
    "/tours/:id/interest",
    ...mutate(["DRIVER"], "interest", async (c, t, b, req) => {
      requireThat(
        t.status === "OPEN",
        409,
        "TOUR_TAKEN",
        "This tour is no longer open",
      );
      requireThat(
        new Date(t.starts_at) > new Date(),
        422,
        "PAST_TOUR",
        "This tour has already reached its pickup time",
      );
      await D.eligible(c, t, req.user.id, b.vehicle_id);
      const previous = (
        await c.query(
          "SELECT vehicle_id FROM interests WHERE tour_id=$1 AND driver_id=$2",
          [t.id, req.user.id],
        )
      ).rows[0];
      if (previous?.vehicle_id === b.vehicle_id)
        return { interested: true, replayed: true };
      const overlaps = (
        await c.query(
          `SELECT other.id,other.starts_at,other.ends_at FROM assignments a JOIN tours other ON other.id=a.tour_id
      WHERE a.driver_id=$1 AND a.ended_at IS NULL AND other.status IN ('ASSIGNED','IN_PROGRESS') AND other.starts_at < $3 AND other.ends_at > $2`,
          [req.user.id, t.starts_at, t.ends_at],
        )
      ).rows;
      requireThat(
        !overlaps.length || b.acknowledge_overlap,
        409,
        "OVERLAP_WARNING",
        "This tour overlaps an assigned trip. Review and acknowledge the warning.",
      );
      await c.query(
        "INSERT INTO interests(tour_id,driver_id,vehicle_id) VALUES($1,$2,$3) ON CONFLICT(tour_id,driver_id) DO UPDATE SET vehicle_id=EXCLUDED.vehicle_id",
        [t.id, req.user.id, b.vehicle_id],
      );
      await D.notify(
        c,
        t.agent_id,
        "A driver is interested in your tour",
        t.id,
      );
      return { interested: true, overlap_warning: !!overlaps.length };
    }),
  );
  app.get(
    "/tours/:id/interests",
    roles("AGENT"),
    approved,
    async (req, res) => {
      uuid.parse(req.params.id);
      const t = (
        await db.query("SELECT * FROM tours WHERE id=$1 AND agent_id=$2", [
          req.params.id,
          req.user.id,
        ])
      ).rows[0];
      requireThat(t, 404, "NOT_FOUND", "Tour not found");
      const rows = (
        await db.query(
          "SELECT driver_id,vehicle_id FROM interests WHERE tour_id=$1 ORDER BY created_at",
          [t.id],
        )
      ).rows;
      const out = [];
      for (const a of rows)
        out.push({
          driver_id: a.driver_id,
          vehicle_id: a.vehicle_id,
          card: await D.driverCard(db, a),
        });
      ok(res, out);
    },
  );
  app.post(
    "/tours/:id/assign",
    ...mutate(["AGENT"], "assign", async (c, t, b, req) => {
      D.transition(t, "ASSIGNED");
      requireThat(
        new Date(t.starts_at) > new Date(),
        422,
        "PAST_TOUR",
        "Cannot assign a past tour",
      );
      const interest = (
        await c.query(
          "SELECT * FROM interests WHERE tour_id=$1 AND driver_id=$2",
          [t.id, b.driver_id],
        )
      ).rows[0];
      requireThat(
        interest,
        422,
        "INTEREST_REQUIRED",
        "Select an interested driver",
      );
      await D.eligible(c, t, b.driver_id, interest.vehicle_id);
      const a = (
        await c.query(
          "INSERT INTO assignments(id,tour_id,driver_id,vehicle_id,trip_snapshot) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [
            randomUUID(),
            t.id,
            b.driver_id,
            interest.vehicle_id,
            JSON.stringify(D.tripSnapshot(t)),
          ],
        )
      ).rows[0];
      await state(c, t, "ASSIGNED", req.user);
      await D.notify(c, b.driver_id, "You have been selected for a tour", t.id);
      const others = (
        await c.query(
          "SELECT driver_id FROM interests WHERE tour_id=$1 AND driver_id<>$2",
          [t.id, b.driver_id],
        )
      ).rows;
      for (const other of others)
        await D.notify(
          c,
          other.driver_id,
          "A tour you followed is now taken",
          t.id,
        );
      return { assignment_id: a.id };
    }),
  );
  app.get("/tours/:id/preview", roles("AGENT"), approved, async (req, res) => {
    uuid.parse(req.params.id);
    const out = await db.transaction(async (c) => {
      const t = (
        await c.query(
          "SELECT * FROM tours WHERE id=$1 AND agent_id=$2 FOR SHARE",
          [req.params.id, req.user.id],
        )
      ).rows[0];
      requireThat(
        t && t.status === "ASSIGNED",
        404,
        "NOT_FOUND",
        "Assigned tour not found",
      );
      const a = await D.activeAssignment(c, t.id);
      requireThat(a, 409, "ASSIGNMENT_REQUIRED", "No active assignment");
      const tourist = (
        await c.query("SELECT name,phone FROM users WHERE id=$1", [
          t.tourist_id,
        ])
      ).rows[0];
      const quote = (
        await c.query(
          "SELECT total_minor,deposit_minor FROM quotes WHERE tour_id=$1 AND status='ACCEPTED'",
          [t.id],
        )
      ).rows[0];
      return {
        money: {
          total_minor: quote.total_minor,
          deposit_minor: quote.deposit_minor,
          payout_minor: t.payout_minor,
          commission_minor: String(
            BigInt(quote.total_minor) - BigInt(t.payout_minor),
          ),
          collector: t.collector,
          collection_minor: t.collection_minor,
          deposit_received: t.deposit_received,
        },
        tourist_card: await D.driverCard(c, a),
        driver_card: {
          pickup: t.pickup,
          destination: t.destination,
          starts_at: t.starts_at,
          ends_at: t.ends_at,
          passengers: t.passengers,
          payout_minor: t.payout_minor,
          tourist_first_name: tourist.name.trim().split(/\s+/)[0],
          phone_if_authorized: tourist.phone,
          instructions: t.instructions,
          ...(t.collector === "DRIVER"
            ? {
                collection_minor: t.collection_minor,
                payable_to_agent_minor: String(
                  BigInt(t.collection_minor) - BigInt(t.payout_minor),
                ),
              }
            : {}),
        },
      };
    });
    ok(res, out);
  });
  app.post(
    "/tours/:id/send",
    ...mutate(["AGENT"], "send", async (c, t, b, req) => {
      const key = req.get("Idempotency-Key");
      requireThat(
        key && /^[a-zA-Z0-9_-]{8,100}$/.test(key),
        400,
        "IDEMPOTENCY_REQUIRED",
        "Supply an Idempotency-Key (8–100 letters, digits, underscores or hyphens)",
      );
      requireThat(
        t.status === "ASSIGNED",
        409,
        "ASSIGNMENT_REQUIRED",
        "Tour must be assigned",
      );
      const a = await D.activeAssignment(c, t.id);
      requireThat(
        a && !a.withdrawal_reason,
        409,
        "ASSIGNMENT_REQUIRED",
        "Active driver is required",
      );
      if (a.sent_at) {
        requireThat(
          a.sent_key === key && a.release_phone === b.release_phone,
          409,
          "ALREADY_SENT",
          "Details already sent; use the contact release action to change sharing",
        );
        return { sent: true, replayed: true };
      }
      await D.eligible(c, t, a.driver_id, a.vehicle_id);
      await c.query(
        "UPDATE assignments SET sent_at=now(),sent_key=$2,release_phone=$3 WHERE id=$1",
        [a.id, key, b.release_phone],
      );
      await D.audit(
        c,
        req.user.id,
        "DETAILS_SENT",
        t.id,
        "Agent confirmed release",
        { assignment_id: a.id, release_phone: b.release_phone },
      );
      await D.notify(c, t.tourist_id, "Your driver card is ready", t.id);
      await D.notify(c, a.driver_id, "Your trip card is ready", t.id);
      return { sent: true, replayed: false };
    }),
  );
  app.post(
    "/tours/:id/contact",
    ...mutate(["AGENT"], "send", async (c, t, b, req) => {
      requireThat(
        ["ASSIGNED", "IN_PROGRESS"].includes(t.status),
        409,
        "TOUR_STATE",
        "Contact sharing is unavailable",
      );
      const a = await D.activeAssignment(c, t.id);
      requireThat(
        a?.sent_at && !a.withdrawal_reason,
        409,
        "SEND_REQUIRED",
        "An active released assignment is required",
      );
      await c.query("UPDATE assignments SET release_phone=$2 WHERE id=$1", [
        a.id,
        b.release_phone,
      ]);
      await D.audit(
        c,
        req.user.id,
        b.release_phone ? "CONTACT_RELEASED" : "CONTACT_REVOKED",
        t.id,
        "Agent changed contact sharing",
        { assignment_id: a.id },
      );
    }),
  );
  app.post(
    "/tours/:id/acknowledge",
    ...mutate(["DRIVER"], null, async (c, t, b, req) => {
      const a = await assigned(c, t, req.user);
      requireThat(
        t.status === "ASSIGNED" && a.sent_at && !a.withdrawal_reason,
        409,
        "SEND_REQUIRED",
        "Released assignment required",
      );
      await c.query(
        "UPDATE assignments SET acknowledged_at=now() WHERE id=$1",
        [a.id],
      );
      await c.query(
        "UPDATE changes SET acknowledged_at=now() WHERE tour_id=$1 AND status='ACCEPTED' AND acknowledged_at IS NULL",
        [t.id],
      );
      await D.audit(c, req.user.id, "ASSIGNMENT_ACKNOWLEDGED", t.id);
      await D.notify(
        c,
        t.agent_id,
        "Driver acknowledged the trip details",
        t.id,
      );
    }),
  );
  app.post(
    "/tours/:id/withdraw",
    ...mutate(["DRIVER"], "reason", async (c, t, b, req) => {
      const a = await assigned(c, t, req.user);
      requireThat(
        t.status === "ASSIGNED" && !a.withdrawal_reason,
        409,
        "WITHDRAWAL_STATE",
        "Only an active unstarted assignment can be withdrawn",
      );
      await c.query(
        "UPDATE assignments SET withdrawal_reason=$2,release_phone=false WHERE id=$1",
        [a.id, b.reason],
      );
      await D.audit(c, req.user.id, "DRIVER_WITHDRAWN", t.id, b.reason);
      await D.audit(c, req.user.id, "CONTACT_REVOKED", t.id, "Driver withdrew");
      await D.notify(
        c,
        t.agent_id,
        "Urgent: selected driver cannot attend",
        t.id,
      );
    }),
  );
  app.post(
    "/tours/:id/reopen",
    ...mutate(["AGENT"], "reason", async (c, t, b, req) => {
      requireThat(
        t.status === "ASSIGNED",
        409,
        "REOPEN_STATE",
        "Only an assigned tour can be reopened",
      );
      const a = await D.activeAssignment(c, t.id);
      requireThat(a, 409, "ASSIGNMENT_REQUIRED", "No active assignment");
      await c.query(
        "UPDATE assignments SET ended_at=now(),end_reason=$2,release_phone=false,end_kind='REOPENED',trip_snapshot=$3 WHERE id=$1",
        [a.id, b.reason, JSON.stringify(D.tripSnapshot(t))],
      );
      await c.query("DELETE FROM interests WHERE tour_id=$1", [t.id]);
      await state(c, t, "OPEN", req.user, b.reason);
      await D.audit(c, req.user.id, "CONTACT_REVOKED", t.id, b.reason, {
        assignment_id: a.id,
      });
      await D.notify(c, a.driver_id, "Your assignment has been revoked", t.id);
      await D.notify(
        c,
        t.tourist_id,
        "Your agent is arranging a replacement driver",
        t.id,
      );
      await D.notifyMatching(c, t);
    }),
  );
  app.post(
    "/tours/:id/status",
    ...mutate(["DRIVER"], "status", async (c, t, b, req) => {
      const a = await assigned(c, t, req.user);
      requireThat(
        a.sent_at && a.acknowledged_at && !a.withdrawal_reason,
        409,
        "ACKNOWLEDGEMENT_REQUIRED",
        "Acknowledge the current trip card first",
      );
      await state(c, t, b.status, req.user);
      if (b.status === "COMPLETED")
        await c.query("UPDATE assignments SET trip_snapshot=$2 WHERE id=$1", [
          a.id,
          JSON.stringify(D.tripSnapshot(t)),
        ]);
      await participants(
        c,
        t,
        b.status === "COMPLETED"
          ? "Your trip is complete"
          : "Your trip has started",
      );
    }),
  );
  app.post(
    "/tours/:id/cancel",
    ...mutate(["TOURIST", "AGENT"], "reason", async (c, t, b, req) => {
      await state(c, t, "CANCELLED", req.user, b.reason);
      const a = await D.activeAssignment(c, t.id);
      if (a) {
        await c.query(
          "UPDATE assignments SET ended_at=now(),end_reason=$2,release_phone=false,end_kind='CANCELLED',trip_snapshot=$3 WHERE id=$1",
          [a.id, b.reason, JSON.stringify(D.tripSnapshot(t))],
        );
        await D.notify(c, a.driver_id, "Your tour was cancelled", t.id);
        await D.audit(c, req.user.id, "CONTACT_REVOKED", t.id, b.reason);
      }
      await participants(c, t, "A tour has been cancelled");
    }),
  );
  app.post(
    "/tours/:id/changes",
    ...mutate(["TOURIST"], "change", async (c, t, b, req) => {
      requireThat(
        ["ACCEPTED", "OPEN", "ASSIGNED"].includes(t.status),
        409,
        "CHANGE_STATE",
        "Changes are allowed after acceptance and before departure",
      );
      const id = randomUUID();
      await c.query(
        "INSERT INTO changes(id,tour_id,actor_id,request) VALUES($1,$2,$3,$4)",
        [id, t.id, req.user.id, b.request],
      );
      await D.notify(c, t.agent_id, "A tourist requested a trip change", t.id);
      return { id };
    }),
  );
  app.post(
    "/tours/:id/changes/:changeId/review",
    ...mutate(["AGENT"], "reviewChange", async (c, t, b, req) => {
      uuid.parse(req.params.changeId);
      requireThat(
        ["ACCEPTED", "OPEN", "ASSIGNED"].includes(t.status),
        409,
        "CHANGE_STATE",
        "Trip has already started or ended",
      );
      const change = (
        await c.query(
          "SELECT * FROM changes WHERE id=$1 AND tour_id=$2 FOR UPDATE",
          [req.params.changeId, t.id],
        )
      ).rows[0];
      requireThat(
        change && change.status === "PENDING",
        409,
        "CHANGE_STATE",
        "Pending change not found",
      );
      if (b.accept) {
        const starts = b.starts_at || t.starts_at,
          ends = b.ends_at || t.ends_at;
        requireThat(
          new Date(starts) > new Date() && new Date(ends) > new Date(starts),
          422,
          "TIME_RANGE",
          "Choose a future valid trip interval",
        );
        await c.query(
          "UPDATE tours SET pickup=$2,starts_at=$3,ends_at=$4 WHERE id=$1",
          [t.id, b.pickup || t.pickup, starts, ends],
        );
        const a = await D.activeAssignment(c, t.id);
        if (a) {
          await c.query(
            "UPDATE assignments SET acknowledged_at=NULL WHERE id=$1",
            [a.id],
          );
          await D.notify(
            c,
            a.driver_id,
            "Trip details changed. Acknowledge the update.",
            t.id,
          );
        }
        await D.audit(c, req.user.id, "TRIP_CHANGE_ACCEPTED", t.id, b.response);
        if (t.status === "OPEN") await D.notifyMatching(c, t);
      }
      await c.query("UPDATE changes SET status=$2,response=$3 WHERE id=$1", [
        change.id,
        b.accept ? "ACCEPTED" : "REJECTED",
        b.response,
      ]);
      await D.notify(
        c,
        t.tourist_id,
        "Your trip change request was reviewed",
        t.id,
      );
    }),
  );
  app.post(
    "/tours/:id/rating",
    ...mutate(["TOURIST", "AGENT"], "rating", async (c, t, b, req) => {
      requireThat(
        t.status === "COMPLETED",
        409,
        "NOT_COMPLETED",
        "Rate only completed trips",
      );
      const a = await D.activeAssignment(c, t.id);
      const permitted =
        req.user.role === "TOURIST"
          ? [t.agent_id, a?.driver_id]
          : [a?.driver_id];
      requireThat(
        permitted.includes(b.target_id),
        403,
        "RATING_TARGET",
        "You cannot rate this user for this trip",
      );
      await c.query(
        "INSERT INTO ratings(id,tour_id,author_id,target_id,score,comment) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), t.id, req.user.id, b.target_id, b.score, b.comment],
      );
      await D.audit(c, req.user.id, "RATING_CREATED", t.id);
    }),
  );
  app.post(
    "/tours/:id/settlement",
    ...mutate(["AGENT"], "settlement", async (c, t, b, req) => {
      requireThat(
        t.status === "COMPLETED",
        409,
        "NOT_COMPLETED",
        "Record settlement after completion",
      );
      const expected =
        t.collector === "DRIVER"
          ? BigInt(t.collection_minor) - BigInt(t.payout_minor)
          : BigInt(t.payout_minor);
      requireThat(
        BigInt(b.amount_minor) === expected,
        422,
        "SETTLEMENT_AMOUNT",
        "Settlement must match the agreed collection and payout",
      );
      const id = randomUUID();
      await c.query(
        "INSERT INTO settlements(id,tour_id,amount_minor,note) VALUES($1,$2,$3,$4)",
        [id, t.id, b.amount_minor, b.note],
      );
      await c.query(
        "INSERT INTO settlement_events(id,settlement_id,actor_id,action) VALUES($1,$2,$3,$4)",
        [randomUUID(), id, req.user.id, "RECORDED"],
      );
      await D.audit(c, req.user.id, "SETTLEMENT_RECORDED", t.id);
      return { id };
    }),
  );
  app.get(
    "/settlements",
    roles("AGENT", "DRIVER"),
    approved,
    async (req, res) => {
      const rows = (
        await db.query(
          `SELECT s.* FROM settlements s JOIN tours t ON t.id=s.tour_id WHERE ${"t.agent_id=$1 AND $2='AGENT' OR $2='DRIVER' AND EXISTS(SELECT 1 FROM assignments a WHERE a.tour_id=t.id AND a.driver_id=$1 AND a.ended_at IS NULL)"} ORDER BY s.created_at DESC LIMIT 100`,
          [req.user.id, req.user.role],
        )
      ).rows;
      ok(res, rows);
    },
  );
  app.post(
    "/tours/:id/settlement/confirm",
    ...mutate(["AGENT", "DRIVER"], null, async (c, t, b, req) => {
      if (req.user.role === "DRIVER") await assigned(c, t, req.user);
      const column =
        req.user.role === "AGENT"
          ? "agent_confirmed_at"
          : "driver_confirmed_at";
      const current = (
        await c.query("SELECT * FROM settlements WHERE tour_id=$1 FOR UPDATE", [
          t.id,
        ])
      ).rows[0];
      requireThat(current, 404, "NOT_FOUND", "Settlement not found");
      if (current[column]) return { confirmed: true, replayed: true };
      const s = (
        await c.query(
          `UPDATE settlements SET ${column}=COALESCE(${column},now()) WHERE tour_id=$1 RETURNING id`,
          [t.id],
        )
      ).rows[0];
      requireThat(s, 404, "NOT_FOUND", "Settlement not found");
      await c.query(
        "INSERT INTO settlement_events(id,settlement_id,actor_id,action) VALUES($1,$2,$3,$4)",
        [randomUUID(), s.id, req.user.id, req.user.role + "_CONFIRMED"],
      );
      await D.audit(c, req.user.id, "SETTLEMENT_CONFIRMED", t.id);
    }),
  );
};
