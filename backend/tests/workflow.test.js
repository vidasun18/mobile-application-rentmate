const request = require("supertest");
const { randomUUID } = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createDatabase } = require("../src/db");
const { createApp } = require("../src/app");
const { migrate } = require("../scripts/migrate");
const { deliverPush } = require("../src/push");
const secret = "test-only-secret-generated-for-isolated-suite";
const password = "Test-only-long-password-983!";
let db, app, tourist, agent, d1, d2, admin, v1, v2, completed;
const call = (u, method, path, body, headers = {}) => {
  let r = request(app)[method](path);
  if (u) r = r.set("Authorization", `Bearer ${u.token}`);
  for (const [key, value] of Object.entries(headers)) r = r.set(key, value);
  return body === undefined ? r : r.send(body);
};
async function register(role, name) {
  const email = `${name.toLowerCase().replace(/\W/g, "")}-${randomUUID()}@example.test`;
  const r = await call(null, "post", "/auth/register", {
    email,
    password,
    role,
    name,
    phone: `+9477${Math.floor(Math.random() * 10000000)}`,
    ...(role === "AGENT" ? { agency_name: "Ceylon Trails" } : {}),
  });
  if (r.status !== 201)
    throw new Error(`Register failed: ${JSON.stringify(r.body)}`);
  return { ...r.body.data.user, token: r.body.data.token, email };
}
async function login(user) {
  const r = await call(null, "post", "/auth/login", {
    email: user.email,
    password,
  });
  expect(r.status).toBe(200);
  user.token = r.body.data.token;
  return user;
}
async function approve(user) {
  const r = await call(admin, "patch", `/admin/users/${user.id}`, {
    status: "APPROVED",
    reason: "Documents checked in test scenario",
  });
  expect(r.status).toBe(200);
  await login(user);
}
async function member(driver) {
  expect(
    (await call(driver, "post", `/agencies/${agent.id}/apply`, {})).status,
  ).toBe(201);
  const rows = (await call(agent, "get", "/agencies/members")).body.data;
  const m = rows.find((x) => x.driver_id === driver.id);
  expect(
    (
      await call(agent, "patch", `/agencies/members/${m.id}`, {
        status: "ACCEPTED",
      })
    ).status,
  ).toBe(200);
  return m;
}
async function vehicle(driver, type, plate) {
  const r = await call(driver, "post", "/vehicles", {
    type,
    registration: plate,
    model: "Toyota test van",
    seats: 9,
  });
  expect(r.status).toBe(201);
  expect(
    (
      await call(admin, "patch", `/admin/vehicles/${r.body.data.id}`, {
        reason: "Vehicle inspected in test",
      })
    ).status,
  ).toBe(200);
  return r.body.data;
}
async function requested(type = "VAN") {
  const starts = new Date(Date.now() + 86400000 * 3);
  const r = await call(tourist, "post", "/tours", {
    agent_id: agent.id,
    pickup: "Mirissa Bay",
    destination: "Ella",
    starts_at: starts.toISOString(),
    ends_at: new Date(+starts + 4 * 3600000).toISOString(),
    vehicle_type: type,
    passengers: 3,
    notes: "Two bags",
  });
  expect(r.status).toBe(201);
  return r.body.data;
}
async function openTour(type = "VAN") {
  const t = await requested(type);
  expect(
    (
      await call(agent, "post", `/tours/${t.id}/quote`, {
        total_minor: 2000000,
        deposit_minor: 500000,
        terms: "Deposit recorded outside this app",
      })
    ).status,
  ).toBe(200);
  expect(
    (await call(tourist, "post", `/tours/${t.id}/accept`, { accept: true }))
      .status,
  ).toBe(200);
  expect(
    (
      await call(agent, "post", `/tours/${t.id}/post`, {
        payout_minor: 1200000,
        collector: "DRIVER",
        collection_minor: 1500000,
        instructions: "Collect at pickup",
      })
    ).status,
  ).toBe(200);
  return t;
}
async function interest(driver, vehicle, t, ack = true) {
  const r = await call(driver, "post", `/tours/${t.id}/interest`, {
    vehicle_id: vehicle.id,
    acknowledge_overlap: ack,
  });
  expect(r.status).toBe(200);
}
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      "Run npm run test:sqlite or npm run test:postgres with an EMPTY disposable test database.",
    );
  db = createDatabase(process.env.TEST_DATABASE_URL);
  await migrate(db);
  await migrate(db);
  app = createApp({ db, secret, rateLimits: false });
  const id = randomUUID();
  const email = `admin-${id}@example.test`;
  await db.query(
    "INSERT INTO users(id,email,password_hash,role,status,name) VALUES($1,$2,$3,'ADMIN','APPROVED','Administrator')",
    [id, email, await bcrypt.hash(password, 12)],
  );
  admin = { id, email };
  await login(admin);
  tourist = await register("TOURIST", "Anna Schmidt");
  agent = await register("AGENT", "Agent");
  d1 = await register("DRIVER", "Dilshan");
  d2 = await register("DRIVER", "Nuwan");
  await approve(agent);
  await approve(d1);
  await approve(d2);
  v1 = await vehicle(d1, "VAN", "TEST-001");
  v2 = await vehicle(d2, "KDH", "TEST-002");
  await member(d1);
  await member(d2);
});
afterAll(async () => {
  await db?.close();
});
test("trip times normalize different offsets to UTC before ordering and persistence", async () => {
  const start = new Date(Date.now() + 4 * 86400000);
  const end = new Date(+start + 2 * 3600000);
  const localStart = new Date(+start + 5.5 * 3600000)
    .toISOString()
    .replace("Z", "+05:30");
  const response = await call(tourist, "post", "/tours", {
    agent_id: agent.id,
    pickup: "Mirissa",
    destination: "Ella",
    starts_at: localStart,
    ends_at: end.toISOString(),
    vehicle_type: "VAN",
    passengers: 3,
  });
  expect(response.status).toBe(201);
  expect(response.body.data.starts_at).toBe(start.toISOString());
  expect(response.body.data.ends_at).toBe(end.toISOString());
});
test("membership review includes public vehicle information without licence documents", async () => {
  const rows = (await call(agent, "get", "/agencies/members")).body.data;
  const driver = rows.find((m) => m.driver_id === d2.id);
  expect(driver.profile.vehicles[0].registration).toBe(v2.registration);
  expect(JSON.stringify(driver)).not.toMatch(
    /licence_number|public_id|password_hash/,
  );
  const membership = (await call(d2, "get", "/agencies/members")).body.data[0];
  expect(membership.profile.agency_name).toBe("Ceylon Trails");
});
test("Send preview has the private money box; repeated interest does not send duplicate notifications", async () => {
  const t = await openTour();
  await interest(d2, v2, t);
  const before = +(
    await db.query(
      "SELECT count(*) FROM notifications WHERE user_id=$1 AND resource_id=$2",
      [agent.id, t.id],
    )
  ).rows[0].count;
  const replay = await call(d2, "post", `/tours/${t.id}/interest`, {
    vehicle_id: v2.id,
  });
  expect(replay.body.data.replayed).toBe(true);
  expect(
    +(
      await db.query(
        "SELECT count(*) FROM notifications WHERE user_id=$1 AND resource_id=$2",
        [agent.id, t.id],
      )
    ).rows[0].count,
  ).toBe(before);
  await call(agent, "post", `/tours/${t.id}/assign`, { driver_id: d2.id });
  await db.query(
    "UPDATE users SET bio='Private driver biography' WHERE id=$1",
    [d2.id],
  );
  const preview = (await call(agent, "get", `/tours/${t.id}/preview`)).body
    .data;
  expect(preview.money).toMatchObject({
    total_minor: "2000000",
    deposit_minor: "500000",
    payout_minor: "1200000",
    commission_minor: "800000",
  });
  expect(preview.tourist_card).not.toHaveProperty("bio");
  expect((await call(tourist, "get", `/tours/${t.id}/preview`)).status).toBe(
    403,
  );
  await call(
    agent,
    "post",
    `/tours/${t.id}/send`,
    { release_phone: true },
    { "Idempotency-Key": "audit-preview-send" },
  );
  await call(d2, "post", `/tours/${t.id}/withdraw`, {
    reason: "Vehicle unavailable",
  });
  expect(
    (
      await call(agent, "post", `/tours/${t.id}/contact`, {
        release_phone: true,
      })
    ).status,
  ).toBe(409);
});
test("revoked driver history freezes the old route and omits later pickup changes and private fields", async () => {
  const t = await openTour();
  await interest(d2, v2, t);
  await call(agent, "post", `/tours/${t.id}/assign`, { driver_id: d2.id });
  await call(agent, "post", `/tours/${t.id}/reopen`, {
    reason: "Replace driver for scheduling",
  });
  const change = (
    await call(tourist, "post", `/tours/${t.id}/changes`, {
      request: "Change pickup please",
    })
  ).body.data;
  await call(agent, "post", `/tours/${t.id}/changes/${change.id}/review`, {
    accept: true,
    response: "Pickup changed",
    pickup: "New private pickup hotel",
  });
  const history = (await call(d2, "get", "/me/history")).body.data.find(
    (x) => x.id === t.id,
  );
  expect(history.outcome).toBe("REASSIGNED");
  expect(history.pickup).toBe("Mirissa Bay");
  expect(JSON.stringify(history)).not.toMatch(
    /New private|tourist_id|tourist_phone|commission|quote|licence/,
  );
  expect((await call(d2, "get", `/tours/${t.id}`)).status).toBe(404);
});
test("notification destinations and agent cancellation reputation follow persisted records", async () => {
  const t = await requested();
  await call(tourist, "post", `/tours/${t.id}/cancel`, {
    reason: "Cancelled travel plans",
  });
  const profile = (await call(agent, "get", "/me")).body.data;
  expect(profile.reputation.cancellations).toBeGreaterThan(0);
  const inbox = (await call(agent, "get", "/notifications")).body.data;
  expect(inbox.some((n) => n.resource_kind === "ACCOUNT")).toBe(true);
  expect(inbox.some((n) => n.resource_kind === "MEMBERSHIP")).toBe(true);
  expect(
    inbox.some((n) => n.resource_kind === "TOUR" && n.resource_id === t.id),
  ).toBe(true);
});
test("registration is pending; duplicates and admin self-registration are rejected", async () => {
  const pending = await register("DRIVER", "Pending");
  expect(pending.status).toBe("PENDING");
  expect((await call(pending, "get", "/tours")).status).toBe(403);
  expect(
    (
      await call(null, "post", "/auth/register", {
        email: tourist.email,
        password,
        role: "TOURIST",
        name: "Duplicate",
        phone: "0771234567",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(null, "post", "/auth/register", {
        email: "bad@example.test",
        password,
        role: "ADMIN",
        name: "Bad",
        phone: "0771234567",
      })
    ).status,
  ).toBe(400);
});
test("authentication rejects bad passwords, absent, forged, and expired JWTs", async () => {
  expect(
    (
      await call(null, "post", "/auth/login", {
        email: tourist.email,
        password: "wrong",
      })
    ).status,
  ).toBe(401);
  expect((await call(null, "get", "/me")).status).toBe(401);
  const expired = jwt.sign({ ver: 0 }, secret, {
    subject: tourist.id,
    expiresIn: -1,
    issuer: "rentmate",
    audience: "rentmate-mobile",
  });
  expect((await call({ token: expired }, "get", "/me")).status).toBe(401);
  expect((await call({ token: "forged" }, "get", "/me")).status).toBe(401);
  const stored = (
    await db.query("SELECT password_hash FROM users WHERE id=$1", [tourist.id])
  ).rows[0];
  expect(stored.password_hash).not.toBe(password);
  expect(stored.password_hash.startsWith("$2")).toBe(true);
});
test("role and ownership rules deny tourist driver browsing and cross-agency management", async () => {
  expect((await call(tourist, "get", "/drivers")).status).toBe(404);
  expect((await call(tourist, "get", "/vehicles")).status).toBe(403);
  expect((await call(tourist, "get", "/admin/users")).status).toBe(403);
  const other = await register("AGENT", "Other Agent");
  await approve(other);
  const membership = (await call(agent, "get", "/agencies/members")).body
    .data[0];
  expect(
    (
      await call(other, "patch", `/agencies/members/${membership.id}`, {
        status: "REMOVED",
      })
    ).status,
  ).toBe(404);
  const t = await requested();
  expect((await call(other, "get", `/tours/${t.id}`)).status).toBe(404);
});
test("posting requires quote acceptance; money uses integer minor units and valid ranges", async () => {
  const t = await requested();
  const post = {
    payout_minor: 1200000,
    collector: "AGENT",
    collection_minor: 1500000,
  };
  expect((await call(agent, "post", `/tours/${t.id}/post`, post)).status).toBe(
    409,
  );
  expect(
    (
      await call(agent, "post", `/tours/${t.id}/quote`, {
        total_minor: 100,
        deposit_minor: 200,
        terms: "Bad quote",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call(agent, "post", `/tours/${t.id}/quote`, {
        total_minor: 1.25,
        deposit_minor: 0,
        terms: "Float",
      })
    ).status,
  ).toBe(400);
});
test("feed and targeted notifications require matching approved vehicle and agency membership", async () => {
  const outsider = await register("DRIVER", "Outsider");
  await approve(outsider);
  const car = await vehicle(outsider, "CAR", "TEST-CAR");
  await member(outsider);
  const t = await openTour();
  expect(
    (await call(d1, "get", "/tours")).body.data.some((x) => x.id === t.id),
  ).toBe(true);
  expect(
    (await call(d2, "get", "/tours")).body.data.some((x) => x.id === t.id),
  ).toBe(true);
  expect((await call(outsider, "get", `/tours/${t.id}`)).status).toBe(404);
  expect(
    (
      await call(outsider, "post", `/tours/${t.id}/interest`, {
        vehicle_id: car.id,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await db.query(
        "SELECT * FROM notifications WHERE user_id=$1 AND resource_id=$2",
        [outsider.id, t.id],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query(
        "SELECT * FROM notifications WHERE user_id=$1 AND resource_id=$2",
        [d2.id, t.id],
      )
    ).rows,
  ).toHaveLength(1);
});
test("full workflow: concurrent selection, Send privacy, acknowledgment, changes, completion and ratings", async () => {
  const t = await openTour();
  await interest(d1, v1, t);
  await interest(d2, v2, t);
  const before = (await call(d1, "get", `/tours/${t.id}`)).body.data;
  expect(JSON.stringify(before)).not.toContain(tourist.phone);
  expect(before).not.toHaveProperty("commission_minor");
  expect(before).not.toHaveProperty("quote");
  expect(before).not.toHaveProperty("tourist_first_name");
  expect(
    (await call(tourist, "get", `/tours/${t.id}`)).body.data,
  ).not.toHaveProperty("driver_card");
  const raced = await Promise.all([
    call(agent, "post", `/tours/${t.id}/assign`, { driver_id: d1.id }),
    call(agent, "post", `/tours/${t.id}/assign`, { driver_id: d2.id }),
  ]);
  expect(raced.map((x) => x.status).sort()).toEqual([200, 409]);
  const assignments = (
    await db.query(
      "SELECT * FROM assignments WHERE tour_id=$1 AND ended_at IS NULL",
      [t.id],
    )
  ).rows;
  expect(assignments).toHaveLength(1);
  const driver = assignments[0].driver_id === d1.id ? d1 : d2;
  expect(
    (
      await call(driver, "post", `/tours/${t.id}/status`, {
        status: "IN_PROGRESS",
      })
    ).status,
  ).toBe(409);
  const headers = { "Idempotency-Key": "complete-flow-send-01" };
  expect(
    (await call(agent, "post", `/tours/${t.id}/deposit`, { accept: true }))
      .status,
  ).toBe(200);
  expect(
    (await call(tourist, "get", `/tours/${t.id}`)).body.data.deposit_received,
  ).toBe(true);
  expect(
    (
      await call(
        agent,
        "post",
        `/tours/${t.id}/send`,
        { release_phone: false },
        headers,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await call(
        agent,
        "post",
        `/tours/${t.id}/send`,
        { release_phone: false },
        headers,
      )
    ).body.data.replayed,
  ).toBe(true);
  expect(
    (
      await db.query(
        "SELECT * FROM audit_logs WHERE resource_id=$1 AND action='DETAILS_SENT'",
        [t.id],
      )
    ).rows,
  ).toHaveLength(1);
  const driverView = (await call(driver, "get", `/tours/${t.id}`)).body.data;
  expect(driverView.tourist_first_name).toBe("Anna");
  expect(driverView).not.toHaveProperty("tourist_phone");
  expect(driverView).not.toHaveProperty("commission_minor");
  expect(driverView.payable_to_agent_minor).toBe("300000");
  const touristView = (await call(tourist, "get", `/tours/${t.id}`)).body.data;
  expect(touristView.driver_card.name).toBe(driver.name);
  expect(JSON.stringify(touristView)).not.toContain(driver.phone);
  expect(touristView).not.toHaveProperty("payout_minor");
  expect(touristView).not.toHaveProperty("commission_minor");
  expect(
    (
      await call(tourist, "post", `/tours/${t.id}/rating`, {
        target_id: driver.id,
        score: 5,
      })
    ).status,
  ).toBe(409);
  expect(
    (await call(driver, "post", `/tours/${t.id}/acknowledge`, {})).status,
  ).toBe(200);
  const change = (
    await call(tourist, "post", `/tours/${t.id}/changes`, {
      request: "Please pick up at the hotel reception",
    })
  ).body.data;
  expect(
    (
      await call(agent, "post", `/tours/${t.id}/changes/${change.id}/review`, {
        accept: true,
        response: "Confirmed with hotel",
        pickup: "Hotel reception",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(driver, "post", `/tours/${t.id}/status`, {
        status: "IN_PROGRESS",
      })
    ).status,
  ).toBe(409);
  await call(driver, "post", `/tours/${t.id}/acknowledge`, {});
  expect(
    (
      await call(driver, "post", `/tours/${t.id}/status`, {
        status: "IN_PROGRESS",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(tourist, "post", `/tours/${t.id}/cancel`, {
        reason: "Changed plans",
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(driver, "post", `/tours/${t.id}/status`, {
        status: "COMPLETED",
      })
    ).status,
  ).toBe(200);
  for (const [author, target] of [
    [tourist, driver],
    [tourist, agent],
    [agent, driver],
  ])
    expect(
      (
        await call(author, "post", `/tours/${t.id}/rating`, {
          target_id: target.id,
          score: 5,
          comment: "Good trip",
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await call(tourist, "post", `/tours/${t.id}/rating`, {
        target_id: driver.id,
        score: 4,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await call(agent, "post", `/tours/${t.id}/reopen`, {
        reason: "Cannot reopen completed",
      })
    ).status,
  ).toBe(409);
  const record = { amount_minor: 300000, note: "Cash handover" };
  expect(
    (
      await call(agent, "post", `/tours/${t.id}/settlement`, {
        amount_minor: 1,
      })
    ).status,
  ).toBe(422);
  expect(
    (await call(agent, "post", `/tours/${t.id}/settlement`, record)).status,
  ).toBe(200);
  for (const u of [driver, agent])
    expect(
      (await call(u, "post", `/tours/${t.id}/settlement/confirm`, {})).status,
    ).toBe(200);
  const settled = (await call(driver, "get", `/tours/${t.id}`)).body.data
    .settlement;
  expect(settled.agent_confirmed_at).toBeTruthy();
  expect(settled.driver_confirmed_at).toBeTruthy();
  completed = t;
});
test("withdrawal and reopen revoke private access, preserve history and allow a replacement", async () => {
  const t = await openTour();
  await interest(d1, v1, t);
  await call(agent, "post", `/tours/${t.id}/assign`, { driver_id: d1.id });
  await call(
    agent,
    "post",
    `/tours/${t.id}/send`,
    { release_phone: true },
    { "Idempotency-Key": "replacement-send-001" },
  );
  expect(
    (await call(d1, "get", `/tours/${t.id}`)).body.data.tourist_phone,
  ).toBe(tourist.phone);
  expect(
    (
      await call(d1, "post", `/tours/${t.id}/withdraw`, {
        reason: "Vehicle repair required",
      })
    ).status,
  ).toBe(200);
  expect(
    (await call(d1, "get", `/tours/${t.id}`)).body.data,
  ).not.toHaveProperty("tourist_phone");
  expect(
    (
      await call(agent, "post", `/tours/${t.id}/reopen`, {
        reason: "Find replacement driver",
      })
    ).status,
  ).toBe(200);
  expect((await call(d1, "get", `/tours/${t.id}`)).status).toBe(404);
  expect(
    (await call(tourist, "get", `/tours/${t.id}`)).body.data,
  ).not.toHaveProperty("driver_card");
  await interest(d2, v2, t);
  expect(
    (await call(agent, "post", `/tours/${t.id}/assign`, { driver_id: d2.id }))
      .status,
  ).toBe(200);
  expect(
    (
      await call(
        agent,
        "post",
        `/tours/${t.id}/send`,
        { release_phone: false },
        { "Idempotency-Key": "replacement-send-002" },
      )
    ).status,
  ).toBe(200);
  const history = (
    await db.query("SELECT * FROM assignments WHERE tour_id=$1", [t.id])
  ).rows;
  expect(history).toHaveLength(2);
  expect(history.filter((x) => !x.ended_at)).toHaveLength(1);
});
test("overlap warning requires acknowledgment; removed membership denies feed", async () => {
  const t = await openTour();
  const conflict = await call(d2, "post", `/tours/${t.id}/interest`, {
    vehicle_id: v2.id,
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body.error.code).toBe("OVERLAP_WARNING");
  await interest(d2, v2, t);
  const m = (await call(agent, "get", "/agencies/members")).body.data.find(
    (x) => x.driver_id === d1.id,
  );
  expect(
    (
      await call(agent, "patch", `/agencies/members/${m.id}`, {
        status: "REMOVED",
      })
    ).status,
  ).toBe(200);
  expect((await call(d1, "get", `/tours/${t.id}`)).status).toBe(404);
});
test("admin private access requires reasons and audits; all unconfigured integrations report unavailable", async () => {
  expect(
    (await call(admin, "post", `/admin/users/${d1.id}/details`, {})).status,
  ).toBe(400);
  expect(
    (
      await call(admin, "post", `/admin/users/${d1.id}/details`, {
        reason: "Safety verification check",
      })
    ).status,
  ).toBe(200);
  expect((await call(admin, "get", `/tours/${completed.id}`)).status).toBe(403);
  expect(
    (
      await call(admin, "post", `/admin/tours/${completed.id}/details`, {
        reason: "Investigate settlement dispute",
      })
    ).status,
  ).toBe(200);
  const logs = (await call(admin, "get", "/admin/audit")).body.data;
  expect(
    logs.some(
      (x) =>
        x.action === "ADMIN_PRIVATE_VIEW" &&
        x.reason === "Safety verification check",
    ),
  ).toBe(true);
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  await deliverPush(db);
  const notifications = (await call(tourist, "get", "/notifications")).body
    .data;
  expect(notifications.some((n) => n.push_status === "UNAVAILABLE")).toBe(true);
  const photo = await request(app)
    .post("/media")
    .set("Authorization", `Bearer ${d1.token}`)
    .field("kind", "DOCUMENT")
    .attach("file", Buffer.from([1, 2, 3]), "test.png");
  expect(photo.status).toBe(503);
});
test("suspension and logout invalidate issued sessions", async () => {
  const u = await register("TOURIST", "Suspension");
  const old = u.token;
  expect(
    (
      await call(admin, "patch", `/admin/users/${u.id}`, {
        status: "SUSPENDED",
        reason: "Safety review required",
      })
    ).status,
  ).toBe(200);
  expect((await call({ token: old }, "get", "/me")).status).toBe(401);
  expect(
    (await call(null, "post", "/auth/login", { email: u.email, password }))
      .status,
  ).toBe(403);
  const fresh = await register("TOURIST", "Logout");
  await call(fresh, "post", "/auth/logout", {});
  expect((await call(fresh, "get", "/me")).status).toBe(401);
});
test("20 sequential list requests meet the local 90% under 2 seconds target", async () => {
  const timings = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    expect((await call(tourist, "get", "/tours")).status).toBe(200);
    timings.push(Math.round((performance.now() - start) * 100) / 100);
  }
  expect(timings.filter((t) => t < 2000).length).toBeGreaterThanOrEqual(18);
  console.log("LOCAL_API_LIST_TIMINGS_MS", JSON.stringify(timings));
});
test("private document metadata and delivery cannot bypass ownership or admin reason auditing", async () => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO media(id,owner_id,kind,public_id) VALUES($1,$2,'DOCUMENT',$3)",
    [id, d1.id, `test-private-${id}`],
  );
  expect((await call(tourist, "post", `/media/${id}/view`, {})).status).toBe(
    404,
  );
  expect((await call(agent, "post", `/media/${id}/view`, {})).status).toBe(404);
  expect((await call(admin, "post", `/media/${id}/view`, {})).status).toBe(400);
  expect((await call(d1, "post", `/media/${id}/view`, {})).status).toBe(503);
  const own = (await call(d1, "get", "/media")).body.data.find(
    (m) => m.id === id,
  );
  expect(own.url).toBeNull();
  expect(own).not.toHaveProperty("public_id");
});
test("development seed creates real fixtures with random passwords and refuses duplicates without resetting data", async () => {
  const { seedDemo } = require("../scripts/seed-demo");
  const seeded = await seedDemo(db);
  expect(seeded).toHaveLength(5);
  expect(new Set(seeded.map((u) => u.password)).size).toBe(5);
  const tourist = seeded.find((u) => u.role === "TOURIST");
  expect(
    (await db.query("SELECT id FROM tours WHERE tourist_id=$1", [tourist.id]))
      .rows,
  ).toHaveLength(2);
  await expect(seedDemo(db)).rejects.toHaveProperty("code", "23505");
  expect(
    (await db.query("SELECT id FROM tours WHERE tourist_id=$1", [tourist.id]))
      .rows,
  ).toHaveLength(2);
});
