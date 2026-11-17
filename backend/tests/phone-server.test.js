const fs = require("node:fs/promises");
const path = require("node:path");
const { startPhoneServer, preparePhone } = require("../scripts/phone-server");
let root;
beforeAll(async () => {
  const local = path.resolve(__dirname, "../../.local");
  await fs.mkdir(local, { recursive: true });
  root = await fs.mkdtemp(path.join(local, "phone-server-test-"));
});
test("phone server creates a private administrator and preserves accounts, credentials and tokens across restarts", async () => {
  const directory = path.join(root, "persistent");
  let api = await startPhoneServer({
    directory,
    host: "127.0.0.1",
    port: 0,
    control: false,
  });
  let base = `http://127.0.0.1:${api.port}`;
  let token;
  let first;
  try {
    expect((await (await fetch(`${base}/health`)).json()).data.status).toBe(
      "ok",
    );
    first = await fs.readFile(path.join(directory, "admin-login.json"), "utf8");
    const account = JSON.parse(first);
    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
    expect(login.status).toBe(200);
    const result = (await login.json()).data;
    expect(result.user.role).toBe("ADMIN");
    token = result.token;
    const registered = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "tourist@phone.example.test",
        password: "test-only-long-password",
        name: "Phone tourist",
        phone: "0771234567",
        role: "TOURIST",
      }),
    });
    expect(registered.status).toBe(201);
    expect((await api.db.query("SELECT id FROM users")).rows).toHaveLength(2);
  } finally {
    await api.stop();
  }
  api = await startPhoneServer({
    directory,
    host: "127.0.0.1",
    port: 0,
    control: false,
  });
  base = `http://127.0.0.1:${api.port}`;
  try {
    expect(
      await fs.readFile(path.join(directory, "admin-login.json"), "utf8"),
    ).toBe(first);
    const me = await fetch(`${base}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()).data.role).toBe("ADMIN");
    expect((await api.db.query("SELECT id FROM users")).rows).toHaveLength(2);
    const hash = (
      await api.db.query("SELECT password_hash FROM users WHERE role='ADMIN'")
    ).rows[0].password_hash;
    expect(hash.startsWith("$2")).toBe(true);
    expect(hash).not.toBe(JSON.parse(first).password);
  } finally {
    await api.stop();
  }
});
test("private Stop control drains the listener and saves the database without an HTTP management endpoint", async () => {
  const directory = path.join(root, "control");
  const api = await startPhoneServer({ directory, host: "127.0.0.1", port: 0 });
  try {
    const response = await fetch(
      `http://127.0.0.1:${api.port}/admin-login.json`,
    );
    expect(response.status).toBe(401);
    await fs.writeFile(path.join(directory, "stop.request"), "stop");
    let status;
    for (let i = 0; i < 80; i++) {
      status = JSON.parse(
        await fs.readFile(path.join(directory, "status.json"), "utf8"),
      );
      if (status.state === "STOPPED") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(status.state).toBe("STOPPED");
    const reopened = await preparePhone(directory);
    try {
      expect(
        (await reopened.db.query("SELECT id FROM users WHERE role='ADMIN'"))
          .rows,
      ).toHaveLength(1);
    } finally {
      await reopened.db.close();
    }
  } finally {
    await api.stop();
  }
});
test("each new phone database has independent generated credentials and configuration", async () => {
  const one = path.join(root, "phone-one"),
    two = path.join(root, "phone-two");
  const a = await preparePhone(one),
    b = await preparePhone(two);
  try {
    expect(a.secret).not.toBe(b.secret);
    const first = JSON.parse(
      await fs.readFile(path.join(one, "admin-login.json"), "utf8"),
    );
    const second = JSON.parse(
      await fs.readFile(path.join(two, "admin-login.json"), "utf8"),
    );
    expect(first.password).not.toBe(second.password);
    expect(first.password.length).toBeGreaterThanOrEqual(20);
  } finally {
    await a.db.close();
    await b.db.close();
  }
});
