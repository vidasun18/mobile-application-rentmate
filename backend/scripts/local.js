const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { createDatabase } = require("../src/db");
const { migrate } = require("./migrate");
const { seedDemo } = require("./seed-demo");
async function prepareLocal() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Local demo mode is development only");
  const directory = path.resolve(__dirname, "../../.local");
  await fs.mkdir(directory, { recursive: true });
  const configPath = path.join(directory, "local-config.json");
  try {
    await fs.writeFile(
      configPath,
      JSON.stringify({ jwtSecret: randomBytes(48).toString("base64url") }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (typeof config.jwtSecret !== "string" || config.jwtSecret.length < 32)
    throw new Error(
      "Invalid local JWT configuration; preserve the database and repair .local/local-config.json",
    );
  process.env.JWT_SECRET = config.jwtSecret;
  process.env.NODE_ENV = "development";
  const filename = path.join(directory, "rentmate.db");
  process.env.DATABASE_URL = `sqlite:${filename}`;
  process.env.LOCAL_MEDIA_DIR = path.join(directory, "media");
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    await migrate(db);
    if (!(await db.query("SELECT id FROM users LIMIT 1")).rows.length) {
      const credentialsPath = path.join(directory, "demo-accounts.json");
      // Fail before seeding if another credential file could be overwritten.
      try {
        await fs.access(credentialsPath);
        throw new Error(
          "An existing demo credential file belongs to another database. Preserve it before initializing an empty database.",
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const accounts = await seedDemo(db);
      await fs.writeFile(credentialsPath, JSON.stringify(accounts, null, 2), {
        flag: "wx",
        mode: 0o600,
      });
      console.log(
        `Five fictional demo accounts created. Generated passwords: ${credentialsPath}`,
      );
    }
  } finally {
    await db.close();
  }
  console.log(`Persistent SQLite database: ${filename}`);
  console.log(
    "Existing accounts and bookings are preserved on restart. Keep .local private.",
  );
}
if (require.main === module)
  prepareLocal()
    .then(() => require("../src/server"))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { prepareLocal };
