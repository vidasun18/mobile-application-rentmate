require("dotenv").config();
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const { createDatabase } = require("../src/db");
async function migrate(db) {
  const directory = path.join(
    __dirname,
    "../migrations",
    db.dialect === "sqlite" ? "sqlite" : "",
  );
  await db.transaction(async (client) => {
    if (db.dialect !== "sqlite")
      await client.query("SELECT pg_advisory_xact_lock(783492)");
    await client.query(
      db.dialect === "sqlite"
        ? "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) STRICT"
        : "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir(directory))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (
          await client.query(
            "SELECT name FROM schema_migrations WHERE name=$1",
            [name],
          )
        ).rows.length
      )
        continue;
      await client.query(await readFile(path.join(directory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        name,
      ]);
    }
  });
}
if (require.main === module) {
  const db = createDatabase(process.env.DATABASE_URL);
  migrate(db)
    .then(() => console.log("Migrations applied"))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
module.exports = { migrate };
