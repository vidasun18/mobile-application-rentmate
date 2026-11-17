const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { createDatabase } = require("../src/db");
const { createApp } = require("../src/app");
const { migrate } = require("./migrate");
const { audit } = require("../src/domain");

async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  await fs.rename(temporary, filename);
}
async function preparePhone(directory) {
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, "phone-config.json");
  let config;
  try {
    config = JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    config = {
      jwtSecret: randomBytes(48).toString("base64url"),
      admin: {
        id: randomUUID(),
        email: "admin@rentmate.local",
        password: randomBytes(20).toString("base64url"),
      },
    };
    // Save credentials before the account transaction, so an interrupted first
    // launch can finish provisioning without generating a different password.
    await fs.writeFile(filename, JSON.stringify(config, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  }
  if (
    typeof config.jwtSecret !== "string" ||
    config.jwtSecret.length < 32 ||
    typeof config.admin?.password !== "string" ||
    config.admin.password.length < 12
  ) {
    throw new Error(
      "Invalid private phone configuration. Preserve the database and configuration for recovery.",
    );
  }
  process.env.LOCAL_MEDIA_DIR = path.join(directory, "media");
  // Addresses must follow the host used by each connected phone, not the laptop.
  delete process.env.PUBLIC_API_URL;
  delete process.env.CLOUDINARY_URL;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const db = createDatabase(`sqlite:${path.join(directory, "rentmate.db")}`);
  try {
    await migrate(db);
    await db.transaction(async (c) => {
      if ((await c.query("SELECT id FROM users LIMIT 1")).rows.length) return;
      await c.query(
        "INSERT INTO users(id,email,password_hash,role,status,name) VALUES($1,$2,$3,'ADMIN','APPROVED','Phone server administrator')",
        [
          config.admin.id,
          config.admin.email,
          await bcrypt.hash(config.admin.password, 12),
        ],
      );
      await audit(
        c,
        config.admin.id,
        "ACCOUNT_PROVISIONED",
        config.admin.id,
        "Phone server first-launch administrator",
      );
    });
    const bootstrap = (
      await db.query("SELECT id FROM users WHERE id=$1 AND role='ADMIN'", [
        config.admin.id,
      ])
    ).rows[0];
    if (bootstrap)
      await atomicJson(path.join(directory, "admin-login.json"), {
        email: config.admin.email,
        password: config.admin.password,
      });
    return { db, secret: config.jwtSecret };
  } catch (error) {
    await db.close();
    throw error;
  }
}
async function startPhoneServer({
  directory,
  host = "0.0.0.0",
  port = 3000,
  control = true,
}) {
  const status = (state, message) =>
    atomicJson(path.join(directory, "status.json"), {
      state,
      message,
      port,
      updated_at: new Date().toISOString(),
    });
  await fs.mkdir(directory, { recursive: true });
  await status("STARTING", "Opening the phone database");
  const { db, secret } = await preparePhone(directory);
  const app = createApp({ db, secret });
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(port, host, () => resolve(listener));
      listener.once("error", reject);
    });
  } catch (error) {
    await db.close();
    throw error;
  }
  port = server.address().port;
  await status(
    "RUNNING",
    "Server running. Other phones can connect on the same Wi-Fi or hotspot.",
  );
  let stopping;
  let poll;
  let polling = false;
  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      clearInterval(poll);
      await status("STOPPING", "Finishing requests and saving the database");
      const force = setTimeout(() => server.closeAllConnections(), 10000);
      await new Promise((resolve) => server.close(resolve));
      clearTimeout(force);
      await db.close();
      await fs.unlink(path.join(directory, "stop.request")).catch(() => {});
      await status("STOPPED", "Server stopped. Your data is saved.");
    })();
    return stopping;
  }
  if (control)
    poll = setInterval(async () => {
      if (polling || stopping) return;
      polling = true;
      try {
        await fs.access(path.join(directory, "stop.request"));
        await stop();
      } catch (error) {
        if (error.code !== "ENOENT")
          await status(
            "FAILED",
            "Server control failed. Reopen the server app.",
          ).catch(() => {});
      } finally {
        polling = false;
      }
    }, 750);
  return { server, db, port, stop };
}
if (require.main === module) {
  const directory = process.argv[2];
  if (!directory || !path.isAbsolute(directory))
    throw new Error("An absolute private data directory is required");
  startPhoneServer({ directory })
    .then(({ stop }) => {
      process.on("SIGTERM", () => {
        void stop();
      });
      process.on("SIGINT", () => {
        void stop();
      });
    })
    .catch(async (error) => {
      await atomicJson(path.join(directory, "status.json"), {
        state: "FAILED",
        message:
          error.code === "EADDRINUSE"
            ? "Port 3000 is already in use. Stop the other server and try again."
            : "Server could not start. Preserve the app data and contact the project administrator.",
      }).catch(() => {});
      console.error("Phone server startup failed:", error.code || error.name);
      process.exitCode = 1;
    });
}
module.exports = { preparePhone, startPhoneServer };
