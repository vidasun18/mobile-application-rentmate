const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const pinoHttp = require("pino-http");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("node:crypto");
const { AppError, requireThat } = require("./errors");
const { schemas, uuid } = require("./validation");
const D = require("./domain");

function createApp({ db, secret, logger, ttl = "8h", rateLimits = true }) {
  requireThat(
    secret?.length >= 32,
    500,
    "CONFIGURATION",
    "JWT_SECRET must have at least 32 characters",
  );
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || false }));
  app.use(express.json({ limit: "32kb" }));
  if (logger)
    app.use(
      pinoHttp({
        logger,
        redact: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
        ],
        serializers: {
          req: (r) => ({
            id: r.id,
            method: r.method,
            url: r.url.split("?")[0],
          }),
        },
      }),
    );
  if (rateLimits)
    app.use(
      rateLimit({
        windowMs: 60000,
        limit: 150,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  const ok = (res, data, status = 200) =>
    res.status(status).json({
      data: require("./local-media").resolveLocalMedia(data, res.req),
    });
  const parse = (name, body) => schemas[name].parse(body);
  const roles =
    (...allowed) =>
    (req, res, next) => {
      requireThat(
        allowed.includes(req.user.role),
        403,
        "FORBIDDEN",
        "This action is unavailable for your role",
      );
      next();
    };
  const approved = (req, res, next) => {
    requireThat(
      req.user.status === "APPROVED",
      403,
      "ACCOUNT_NOT_APPROVED",
      `Your account is ${req.user.status.toLowerCase()}`,
    );
    next();
  };
  const auth = async (req, res, next) => {
    try {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      requireThat(token, 401, "UNAUTHENTICATED", "Please sign in");
      const payload = jwt.verify(token, secret, {
        algorithms: ["HS256"],
        issuer: "rentmate",
        audience: "rentmate-mobile",
      });
      const user = (
        await db.query("SELECT * FROM users WHERE id=$1", [payload.sub])
      ).rows[0];
      requireThat(
        user && user.token_version === payload.ver,
        401,
        "SESSION_EXPIRED",
        "Please sign in again",
      );
      req.user = user;
      next();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "SESSION_EXPIRED", "Your session has expired");
    }
  };
  function token(user) {
    return jwt.sign({ ver: user.token_version }, secret, {
      subject: user.id,
      expiresIn: ttl,
      issuer: "rentmate",
      audience: "rentmate-mobile",
      algorithm: "HS256",
    });
  }
  const me = (u) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status,
    name: u.name,
    phone: u.phone,
    bio: u.bio,
    photo_url: u.photo_url,
  });
  app.get("/health", async (req, res) => {
    await db.query("SELECT 1");
    ok(res, { status: "ok" });
  });
  if (rateLimits)
    app.use(
      "/auth",
      rateLimit({
        windowMs: 15 * 60000,
        limit: 30,
        standardHeaders: "draft-8",
        legacyHeaders: false,
      }),
    );
  app.post("/auth/register", async (req, res) => {
    const b = parse("register", req.body);
    requireThat(
      b.role !== "AGENT" || b.agency_name,
      422,
      "AGENCY_REQUIRED",
      "Enter your agency name",
    );
    const hash = await bcrypt.hash(b.password, 12);
    const u = await db.transaction(async (c) => {
      const u = (
        await c.query(
          "INSERT INTO users(id,email,password_hash,role,status,name,phone) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            randomUUID(),
            b.email,
            hash,
            b.role,
            b.role === "TOURIST" ? "APPROVED" : "PENDING",
            b.name,
            b.phone,
          ],
        )
      ).rows[0];
      if (b.role === "AGENT")
        await c.query(
          "INSERT INTO agent_profiles(user_id,agency_name) VALUES($1,$2)",
          [u.id, b.agency_name],
        );
      if (b.role === "DRIVER")
        await c.query("INSERT INTO driver_profiles(user_id) VALUES($1)", [
          u.id,
        ]);
      await D.audit(c, u.id, "REGISTER", u.id);
      return u;
    });
    ok(res, { token: token(u), user: me(u) }, 201);
  });
  app.post("/auth/login", async (req, res) => {
    const b = parse("login", req.body);
    const u = (await db.query("SELECT * FROM users WHERE email=$1", [b.email]))
      .rows[0];
    const dummy =
      "$2b$12$Tr2RTsDDdLpmgzmZ0HEz/ehJu7SjwxRR8D03lT79WNCD2u6CI6k9G";
    requireThat(
      (await bcrypt.compare(b.password, u?.password_hash || dummy)) && u,
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect",
    );
    requireThat(
      !["SUSPENDED", "REJECTED"].includes(u.status),
      403,
      "ACCOUNT_UNAVAILABLE",
      `Your account is ${u.status.toLowerCase()}. Contact your administrator.`,
    );
    ok(res, { token: token(u), user: me(u) });
  });
  require("./local-media").registerLocalMedia(app, { db, secret });
  app.use(auth);
  app.post("/auth/logout", async (req, res) => {
    await db.transaction(async (c) => {
      await c.query(
        "UPDATE users SET token_version=token_version+1 WHERE id=$1",
        [req.user.id],
      );
      await c.query("DELETE FROM push_tokens WHERE user_id=$1", [req.user.id]);
    });
    ok(res, { logged_out: true });
  });
  app.get("/me", async (req, res) => {
    const out = me(req.user);
    if (req.user.role === "DRIVER")
      out.driver_profile = (
        await db.query(
          "SELECT licence_number,licence_expiry FROM driver_profiles WHERE user_id=$1",
          [req.user.id],
        )
      ).rows[0];
    if (req.user.role === "AGENT")
      out.agent_profile = (
        await db.query(
          "SELECT agency_name,location FROM agent_profiles WHERE user_id=$1",
          [req.user.id],
        )
      ).rows[0];
    out.reputation = await D.reputation(db, req.user.id);
    ok(res, out);
  });
  app.get("/me/dashboard", roles("AGENT"), approved, async (req, res) => {
    const tours = (
      await db.query(
        "SELECT status,count(*)::int AS count FROM tours WHERE agent_id=$1 GROUP BY status",
        [req.user.id],
      )
    ).rows;
    const applications = (
      await db.query(
        "SELECT count(*)::int AS count FROM memberships WHERE agent_id=$1 AND status='PENDING'",
        [req.user.id],
      )
    ).rows[0].count;
    const unread = (
      await db.query(
        "SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL",
        [req.user.id],
      )
    ).rows[0].count;
    ok(res, {
      tours: Object.fromEntries(tours.map((t) => [t.status, t.count])),
      applications,
      unread_notifications: unread,
    });
  });
  app.get(
    "/me/history",
    roles("TOURIST", "AGENT", "DRIVER"),
    approved,
    async (req, res) => {
      if (req.user.role === "DRIVER") {
        const rows = (
          await db.query(
            `SELECT t.id,
        CASE WHEN a.ended_at IS NULL THEN t.pickup ELSE a.trip_snapshot->>'pickup' END AS pickup,
        CASE WHEN a.ended_at IS NULL THEN t.destination ELSE a.trip_snapshot->>'destination' END AS destination,
        CASE WHEN a.ended_at IS NULL THEN t.starts_at ELSE (a.trip_snapshot->>'starts_at')::timestamptz END AS starts_at,
        CASE WHEN a.ended_at IS NULL THEN t.ends_at ELSE (a.trip_snapshot->>'ends_at')::timestamptz END AS ends_at,
        CASE WHEN a.ended_at IS NULL THEN t.vehicle_type ELSE a.trip_snapshot->>'vehicle_type' END AS vehicle_type,
        CASE WHEN a.ended_at IS NULL THEN t.passengers ELSE (a.trip_snapshot->>'passengers')::integer END AS passengers,
        a.id AS assignment_id,a.assigned_at,a.sent_at,a.ended_at,a.end_reason,a.withdrawal_reason,
        CASE WHEN a.withdrawal_reason IS NOT NULL THEN 'WITHDRAWN' WHEN a.end_kind='CANCELLED' THEN 'CANCELLED'
        WHEN a.ended_at IS NOT NULL THEN 'REASSIGNED' ELSE t.status END AS outcome
        FROM assignments a JOIN tours t ON t.id=a.tour_id WHERE a.driver_id=$1 ORDER BY a.assigned_at DESC LIMIT 100`,
            [req.user.id],
          )
        ).rows;
        return ok(res, rows);
      }
      ok(
        res,
        (
          await db.query(
            `SELECT id,pickup,destination,starts_at,ends_at,vehicle_type,passengers,status,status AS outcome FROM tours WHERE ${req.user.role === "AGENT" ? "agent_id" : "tourist_id"}=$1 ORDER BY starts_at DESC LIMIT 100`,
            [req.user.id],
          )
        ).rows,
      );
    },
  );
  app.put("/me", async (req, res) => {
    requireThat(
      !["SUSPENDED", "REJECTED"].includes(req.user.status),
      403,
      "ACCOUNT_UNAVAILABLE",
      "Account unavailable",
    );
    const b = parse("profile", req.body);
    await db.transaction(async (c) => {
      await c.query("UPDATE users SET name=$2,phone=$3,bio=$4 WHERE id=$1", [
        req.user.id,
        b.name,
        b.phone,
        b.bio,
      ]);
      if (
        ["DRIVER", "AGENT"].includes(req.user.role) &&
        req.user.name !== b.name
      )
        await c.query("UPDATE users SET status='PENDING' WHERE id=$1", [
          req.user.id,
        ]);
      if (req.user.role === "DRIVER" && b.licence_number !== undefined) {
        const old = (
          await c.query(
            "SELECT * FROM driver_profiles WHERE user_id=$1 FOR UPDATE",
            [req.user.id],
          )
        ).rows[0];
        await c.query(
          "UPDATE driver_profiles SET licence_number=$2,licence_expiry=$3 WHERE user_id=$1",
          [req.user.id, b.licence_number, b.licence_expiry || null],
        );
        if (
          old.licence_number !== b.licence_number ||
          String(
            old.licence_expiry?.toISOString?.().slice(0, 10) ||
              old.licence_expiry ||
              "",
          ) !== (b.licence_expiry || "")
        )
          await c.query("UPDATE users SET status='PENDING' WHERE id=$1", [
            req.user.id,
          ]);
      }
      if (req.user.role === "AGENT" && b.agency_name) {
        const old = (
          await c.query(
            "SELECT * FROM agent_profiles WHERE user_id=$1 FOR UPDATE",
            [req.user.id],
          )
        ).rows[0];
        await c.query(
          "UPDATE agent_profiles SET agency_name=$2,location=$3 WHERE user_id=$1",
          [req.user.id, b.agency_name, b.location || "Sri Lanka"],
        );
        if (old.agency_name !== b.agency_name)
          await c.query("UPDATE users SET status='PENDING' WHERE id=$1", [
            req.user.id,
          ]);
      }
      await D.audit(c, req.user.id, "PROFILE_UPDATED", req.user.id);
    });
    ok(res, { saved: true });
  });
  app.get("/vehicles", roles("DRIVER"), async (req, res) => {
    const out = (
      await db.query(
        "SELECT * FROM vehicles WHERE driver_id=$1 ORDER BY registration",
        [req.user.id],
      )
    ).rows;
    for (const v of out)
      v.photos = (
        await db.query(
          "SELECT id,url,approved FROM media WHERE vehicle_id=$1 AND kind='VEHICLE_PHOTO'",
          [v.id],
        )
      ).rows;
    ok(res, out);
  });
  app.post("/vehicles", roles("DRIVER"), async (req, res) => {
    requireThat(
      !["SUSPENDED", "REJECTED"].includes(req.user.status),
      403,
      "ACCOUNT_UNAVAILABLE",
      "Account unavailable",
    );
    const b = parse("vehicle", req.body);
    ok(
      res,
      (
        await db.query(
          "INSERT INTO vehicles(id,driver_id,type,registration,model,seats) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [randomUUID(), req.user.id, b.type, b.registration, b.model, b.seats],
        )
      ).rows[0],
      201,
    );
  });
  app.put("/vehicles/:id", roles("DRIVER"), async (req, res) => {
    const b = parse("vehicle", req.body);
    uuid.parse(req.params.id);
    requireThat(
      !["SUSPENDED", "REJECTED"].includes(req.user.status),
      403,
      "ACCOUNT_UNAVAILABLE",
      "Account unavailable",
    );
    const result = await db.transaction(async (c) => {
      const v = (
        await c.query(
          "SELECT * FROM vehicles WHERE id=$1 AND driver_id=$2 FOR UPDATE",
          [req.params.id, req.user.id],
        )
      ).rows[0];
      requireThat(v, 404, "NOT_FOUND", "Vehicle not found");
      requireThat(
        !(
          await c.query(
            "SELECT id FROM assignments a JOIN tours t ON t.id=a.tour_id WHERE a.vehicle_id=$1 AND a.ended_at IS NULL AND t.status IN ('ASSIGNED','IN_PROGRESS')",
            [v.id],
          )
        ).rows.length,
        409,
        "VEHICLE_IN_USE",
        "Finish assigned trips before editing this vehicle",
      );
      return (
        await c.query(
          "UPDATE vehicles SET type=$2,registration=$3,model=$4,seats=$5,approved=false WHERE id=$1 RETURNING *",
          [v.id, b.type, b.registration, b.model, b.seats],
        )
      ).rows[0];
    });
    ok(res, result);
  });
  app.get("/agents", roles("TOURIST", "DRIVER"), approved, async (req, res) => {
    const query = String(req.query.search || "").slice(0, 100);
    const rows = (
      await db.query(
        "SELECT u.id,a.agency_name,a.location FROM users u JOIN agent_profiles a ON a.user_id=u.id WHERE u.status='APPROVED' AND (a.agency_name ILIKE $1 OR a.location ILIKE $1) ORDER BY a.agency_name LIMIT 100",
        [`%${query}%`],
      )
    ).rows;
    const out = [];
    for (const a of rows)
      out.push({
        ...(await D.publicProfile(db, a.id)),
        agency_name: a.agency_name,
        location: a.location,
      });
    ok(res, out);
  });
  app.get(
    "/agencies/members",
    roles("AGENT", "DRIVER"),
    approved,
    async (req, res) => {
      const rows = (
        await db.query(
          `SELECT * FROM memberships WHERE ${req.user.role === "AGENT" ? "agent_id" : "driver_id"}=$1 ORDER BY updated_at DESC LIMIT 200`,
          [req.user.id],
        )
      ).rows;
      const out = [];
      for (const m of rows) {
        const profile = await D.publicProfile(
          db,
          req.user.role === "AGENT" ? m.driver_id : m.agent_id,
        );
        // Membership review reveals public vehicles, never licence/identity documents.
        if (req.user.role === "AGENT")
          profile.vehicles = await D.publicVehicles(db, m.driver_id);
        else
          profile.agency_name = (
            await db.query(
              "SELECT agency_name FROM agent_profiles WHERE user_id=$1",
              [m.agent_id],
            )
          ).rows[0]?.agency_name;
        out.push({ ...m, profile });
      }
      ok(res, out);
    },
  );
  app.post(
    "/agencies/:id/apply",
    roles("DRIVER"),
    approved,
    async (req, res) => {
      uuid.parse(req.params.id);
      await db.transaction(async (c) => {
        requireThat(
          (
            await c.query(
              "SELECT id FROM users WHERE id=$1 AND role='AGENT' AND status='APPROVED' FOR SHARE",
              [req.params.id],
            )
          ).rows.length,
          404,
          "NOT_FOUND",
          "Verified agency not found",
        );
        const m = (
          await c.query(
            "SELECT * FROM memberships WHERE agent_id=$1 AND driver_id=$2 FOR UPDATE",
            [req.params.id, req.user.id],
          )
        ).rows[0];
        requireThat(
          !m || ["REJECTED", "REMOVED"].includes(m.status),
          409,
          "ALREADY_APPLIED",
          "You already applied to this agency",
        );
        await c.query(
          "INSERT INTO memberships(id,agent_id,driver_id,status) VALUES($1,$2,$3,'PENDING') ON CONFLICT(agent_id,driver_id) DO UPDATE SET status='PENDING',updated_at=now()",
          [randomUUID(), req.params.id, req.user.id],
        );
        await D.notify(
          c,
          req.params.id,
          "A driver applied to your agency",
          req.user.id,
          "MEMBERSHIP",
        );
      });
      ok(res, { status: "PENDING" }, 201);
    },
  );
  app.patch(
    "/agencies/members/:id",
    roles("AGENT"),
    approved,
    async (req, res) => {
      const b = parse("membership", req.body);
      uuid.parse(req.params.id);
      await db.transaction(async (c) => {
        const m = (
          await c.query(
            "SELECT * FROM memberships WHERE id=$1 AND agent_id=$2 FOR UPDATE",
            [req.params.id, req.user.id],
          )
        ).rows[0];
        requireThat(m, 404, "NOT_FOUND", "Membership not found");
        requireThat(
          b.status === "REMOVED"
            ? m.status === "ACCEPTED"
            : m.status === "PENDING",
          409,
          "MEMBERSHIP_STATE",
          "This application has already been reviewed",
        );
        if (b.status === "ACCEPTED")
          requireThat(
            (
              await c.query(
                "SELECT id FROM users WHERE id=$1 AND status='APPROVED' FOR SHARE",
                [m.driver_id],
              )
            ).rows.length,
            422,
            "DRIVER_UNVERIFIED",
            "Driver must be verified",
          );
        await c.query(
          "UPDATE memberships SET status=$2,updated_at=now() WHERE id=$1",
          [m.id, b.status],
        );
        await D.audit(c, req.user.id, "MEMBERSHIP_" + b.status, m.id);
        await D.notify(
          c,
          m.driver_id,
          "Agency membership updated",
          m.id,
          "MEMBERSHIP",
        );
      });
      ok(res, { saved: true });
    },
  );
  require("./tours")(app, { db, ok, parse, roles, approved });
  require("./admin")(app, { db, ok, parse, roles, approved });
  require("./media")(app, { db, ok, roles, secret });
  app.get("/notifications", async (req, res) =>
    ok(
      res,
      (
        await db.query(
          "SELECT id,title,resource_id,resource_kind,read_at,created_at,push_status FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [req.user.id],
        )
      ).rows,
    ),
  );
  app.patch("/notifications/:id", async (req, res) => {
    uuid.parse(req.params.id);
    const r = await db.query(
      "UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2 RETURNING id",
      [req.params.id, req.user.id],
    );
    requireThat(r.rows.length, 404, "NOT_FOUND", "Notification not found");
    ok(res, { read: true });
  });
  app.post("/notifications/push-token", async (req, res) => {
    const token = require("zod")
      .z.string()
      .min(20)
      .max(4096)
      .parse(req.body.token);
    await db.query(
      "INSERT INTO push_tokens(user_id,token) VALUES($1,$2) ON CONFLICT(token) DO UPDATE SET user_id=EXCLUDED.user_id",
      [req.user.id, token],
    );
    ok(res, { registered: true });
  });
  app.delete("/notifications/push-token", async (req, res) => {
    await db.query("DELETE FROM push_tokens WHERE user_id=$1 AND token=$2", [
      req.user.id,
      req.body.token || "",
    ]);
    ok(res, { removed: true });
  });
  app.get("/ratings/me", async (req, res) =>
    ok(
      res,
      (
        await db.query(
          "SELECT score,comment,created_at FROM ratings WHERE target_id=$1 ORDER BY created_at DESC LIMIT 100",
          [req.user.id],
        )
      ).rows,
    ),
  );
  app.use((req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Resource not found" } }),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.name === "ZodError")
      return res.status(400).json({
        error: {
          code: "VALIDATION",
          message: "Please check your input",
          details: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      });
    if (error.code === "23505")
      return res.status(409).json({
        error: {
          code: "DUPLICATE",
          message:
            "This record already exists or the action has already completed",
        },
      });
    if (["23503", "23514", "22P02"].includes(error.code))
      return res.status(400).json({
        error: {
          code: "INVALID_REFERENCE",
          message: "Invalid values or reference",
        },
      });
    if (error.type === "entity.parse.failed")
      return res
        .status(400)
        .json({ error: { code: "INVALID_JSON", message: "Invalid JSON" } });
    if (error.code === "LIMIT_FILE_SIZE")
      return res.status(400).json({
        error: {
          code: "FILE_TOO_LARGE",
          message: "Images must be at most 5 MB",
        },
      });
    const status = error.status || 500;
    if (status >= 500) logger?.error({ err: error }, "Request failed");
    res.status(status).json({
      error: {
        code: error.code || "INTERNAL_ERROR",
        message:
          status >= 500 && !(error instanceof AppError)
            ? "Something went wrong"
            : error.message,
      },
    });
  });
  return app;
}
module.exports = { createApp };
