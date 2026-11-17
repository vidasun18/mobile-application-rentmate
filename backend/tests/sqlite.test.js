const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createDatabase } = require("../src/db");
const { migrate } = require("../scripts/migrate");
test("SQLite persists across connections, rolls back failed work, and serializes transactions", async () => {
  const root = path.resolve(__dirname, "../../.local");
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "sqlite-persistence-"));
  const url = `sqlite:${path.join(directory, "persistent.db")}`;
  let db = createDatabase(url);
  const id = randomUUID();
  try {
    await migrate(db);
    await db.query(
      "INSERT INTO users(id,email,password_hash,role,status,name) VALUES($1,$2,'test-only-hash','TOURIST','APPROVED','Original')",
      [id, `${id}@example.test`],
    );
    await expect(
      db.transaction(async (c) => {
        await c.query("UPDATE users SET name='Rolled back' WHERE id=$1", [id]);
        await c.query(
          "INSERT INTO memberships(id,agent_id,driver_id,status) VALUES($1,$2,$3,'PENDING')",
          [randomUUID(), randomUUID(), randomUUID()],
        );
      }),
    ).rejects.toMatchObject({ code: "23503" });
    const order = [];
    await Promise.all([
      db.transaction(async (c) => {
        order.push("first");
        await c.query(
          "UPDATE users SET token_version=token_version+1 WHERE id=$1",
          [id],
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("committed");
      }),
      db.transaction(async (c) => {
        order.push("second");
        await c.query(
          "UPDATE users SET token_version=token_version+1 WHERE id=$1",
          [id],
        );
      }),
    ]);
    expect(order).toEqual(["first", "committed", "second"]);
    await db.close();
    db = createDatabase(url);
    await migrate(db);
    const row = (
      await db.query("SELECT name,token_version FROM users WHERE id=$1", [id])
    ).rows[0];
    expect(row).toEqual({ name: "Original", token_version: 2 });
  } finally {
    await db.close();
  }
});
