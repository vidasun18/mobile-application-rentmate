const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { preparePhone } = require("./phone-server");
const { resolveLocalMedia } = require("../src/local-media");

async function main() {
  const local = path.resolve(__dirname, "../../.local");
  await fs.mkdir(local, { recursive: true });
  const directory = await fs.mkdtemp(path.join(local, "phone-storage-check-"));
  const first = await preparePhone(directory);
  let secret;
  let credentials;
  let originalHash;
  try {
    secret = first.secret;
    credentials = JSON.parse(
      await fs.readFile(path.join(directory, "admin-login.json"), "utf8"),
    );
    const users = (await first.db.query("SELECT * FROM users")).rows;
    assert.equal(users.length, 1);
    assert.equal(users[0].role, "ADMIN");
    assert.equal(users[0].email, credentials.email);
    assert.ok(
      await bcrypt.compare(credentials.password, users[0].password_hash),
    );
    originalHash = users[0].password_hash;
    await assert.rejects(
      first.db.transaction(async (c) => {
        await c.query("UPDATE users SET name='Should roll back' WHERE id=$1", [
          users[0].id,
        ]);
        throw new Error("simulate interrupted transaction");
      }),
    );
    assert.equal(
      (await first.db.query("SELECT name FROM users")).rows[0].name,
      "Phone server administrator",
    );
  } finally {
    await first.db.close();
  }
  const second = await preparePhone(directory);
  try {
    assert.equal(second.secret, secret);
    const restored = JSON.parse(
      await fs.readFile(path.join(directory, "admin-login.json"), "utf8"),
    );
    assert.deepEqual(restored, credentials);
    assert.equal(
      (await second.db.query("SELECT password_hash FROM users")).rows[0]
        .password_hash,
      originalHash,
    );
  } finally {
    await second.db.close();
  }
  const id = "a8b30338-c677-4a84-ae9a-ae116ce9ee0d";
  const picture = {
    vehicle: { photos: [{ url: `/media/${id}/image` }] },
    photo_url: `http://old-host:3000/media/${id}/image`,
  };
  const req = { protocol: "http", get: () => "192.168.43.1:3000" };
  const resolved = resolveLocalMedia(picture, req);
  assert.equal(
    resolved.vehicle.photos[0].url,
    `http://192.168.43.1:3000/media/${id}/image`,
  );
  assert.equal(
    resolved.photo_url,
    `http://192.168.43.1:3000/media/${id}/image`,
  );
  assert.equal(picture.vehicle.photos[0].url, `/media/${id}/image`);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "private administrator provisioning",
        "password hashing",
        "transaction rollback",
        "database reopen",
        "credentials preserved",
        "Wi-Fi/hotspot media addresses",
      ],
      directory,
    }),
  );
}
main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
