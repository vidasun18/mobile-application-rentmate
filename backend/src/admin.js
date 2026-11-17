const { requireThat } = require("./errors");
const { uuid } = require("./validation");
const D = require("./domain");
module.exports = (app, { db, ok, parse, roles, approved }) => {
  const guard = [roles("ADMIN"), approved];
  app.get("/admin/users", ...guard, async (req, res) => {
    const statuses = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];
    const status = String(req.query.status || "PENDING");
    requireThat(
      statuses.includes(status),
      400,
      "STATUS_INVALID",
      "Choose a valid account status",
    );
    ok(
      res,
      (
        await db.query(
          "SELECT id,name,role,status,created_at FROM users WHERE status=$1 AND role<>'ADMIN' ORDER BY created_at LIMIT 100",
          [status],
        )
      ).rows,
    );
  });
  app.patch("/admin/users/:id", ...guard, async (req, res) => {
    uuid.parse(req.params.id);
    const b = parse("verification", req.body);
    await db.transaction(async (c) => {
      const u = (
        await c.query(
          "SELECT * FROM users WHERE id=$1 AND role<>'ADMIN' FOR UPDATE",
          [req.params.id],
        )
      ).rows[0];
      requireThat(u, 404, "NOT_FOUND", "User not found");
      requireThat(
        u.role !== "TOURIST" ||
          b.status === "SUSPENDED" ||
          b.status === "APPROVED",
        422,
        "VERIFICATION_ROLE",
        "Tourists do not need verification",
      );
      await c.query(
        "UPDATE users SET status=$2,token_version=token_version+1 WHERE id=$1",
        [u.id, b.status],
      );
      await D.audit(c, req.user.id, "ACCOUNT_" + b.status, u.id, b.reason);
      await D.notify(
        c,
        u.id,
        "Your account status was updated",
        u.id,
        "ACCOUNT",
      );
    });
    ok(res, { saved: true });
  });
  app.post("/admin/users/:id/details", ...guard, async (req, res) => {
    uuid.parse(req.params.id);
    const b = parse("reason", req.body);
    const out = await db.transaction(async (c) => {
      const u = (
        await c.query(
          "SELECT id,email,name,phone,role,status,bio FROM users WHERE id=$1",
          [req.params.id],
        )
      ).rows[0];
      requireThat(u, 404, "NOT_FOUND", "User not found");
      await D.audit(c, req.user.id, "ADMIN_PRIVATE_VIEW", u.id, b.reason);
      u.driver_profile =
        (
          await c.query(
            "SELECT licence_number,licence_expiry FROM driver_profiles WHERE user_id=$1",
            [u.id],
          )
        ).rows[0] || null;
      u.documents = (
        await c.query(
          "SELECT id,kind,created_at FROM media WHERE owner_id=$1 AND kind='DOCUMENT'",
          [u.id],
        )
      ).rows;
      u.profile_photos = (
        await c.query(
          "SELECT id,url,approved FROM media WHERE owner_id=$1 AND kind='PROFILE_PHOTO'",
          [u.id],
        )
      ).rows;
      u.vehicles = (
        await c.query(
          "SELECT id,type,model,registration,seats,approved FROM vehicles WHERE driver_id=$1",
          [u.id],
        )
      ).rows;
      for (const v of u.vehicles)
        v.photos = (
          await c.query(
            "SELECT id,url,approved FROM media WHERE vehicle_id=$1 AND kind='VEHICLE_PHOTO'",
            [v.id],
          )
        ).rows;
      return u;
    });
    ok(res, out);
  });
  app.patch("/admin/vehicles/:id", ...guard, async (req, res) => {
    uuid.parse(req.params.id);
    const b = parse("reason", req.body);
    await db.transaction(async (c) => {
      requireThat(
        (
          await c.query(
            "UPDATE vehicles SET approved=true WHERE id=$1 RETURNING id",
            [req.params.id],
          )
        ).rows.length,
        404,
        "NOT_FOUND",
        "Vehicle not found",
      );
      await c.query(
        "UPDATE media SET approved=true WHERE vehicle_id=$1 AND kind='VEHICLE_PHOTO'",
        [req.params.id],
      );
      await D.audit(
        c,
        req.user.id,
        "VEHICLE_APPROVED",
        req.params.id,
        b.reason,
      );
    });
    ok(res, { saved: true });
  });
  app.post("/admin/tours/:id/details", ...guard, async (req, res) => {
    uuid.parse(req.params.id);
    const b = parse("reason", req.body);
    const out = await db.transaction(async (c) => {
      const t = (
        await c.query("SELECT * FROM tours WHERE id=$1 FOR SHARE", [
          req.params.id,
        ])
      ).rows[0];
      requireThat(t, 404, "NOT_FOUND", "Tour not found");
      await D.audit(c, req.user.id, "ADMIN_TOUR_PRIVATE_VIEW", t.id, b.reason);
      return D.serializeTour(c, { id: t.agent_id, role: "AGENT" }, t);
    });
    ok(res, out);
  });
  app.get("/admin/audit", ...guard, async (req, res) =>
    ok(
      res,
      (
        await db.query(
          "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200",
        )
      ).rows,
    ),
  );
};
