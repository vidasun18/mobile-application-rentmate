const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { createDatabase } = require("../src/db");
const { createApp } = require("../src/app");
const { migrate } = require("../scripts/migrate");
const secret = "isolated-local-media-test-secret-over-32-characters";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGNkAAAAASUVORK5CYII=",
  "base64",
);
let db, app, owner, outsider, admin, directory, oldDirectory;
function bearer(user) {
  return `Bearer ${jwt.sign({ ver: 0 }, secret, { subject: user.id, issuer: "rentmate", audience: "rentmate-mobile" })}`;
}
const post = (user, endpoint, body) =>
  request(app).post(endpoint).set("Authorization", bearer(user)).send(body);
function imagePath(url) {
  const u = new URL(url);
  return u.pathname + u.search;
}
beforeAll(async () => {
  const root = path.resolve(__dirname, "../../.local");
  await fs.mkdir(root, { recursive: true });
  directory = await fs.mkdtemp(path.join(root, "local-media-test-"));
  oldDirectory = process.env.LOCAL_MEDIA_DIR;
  process.env.LOCAL_MEDIA_DIR = path.join(directory, "images");
  db = createDatabase(`sqlite:${path.join(directory, "test.db")}`);
  await migrate(db);
  const people = [];
  for (const role of ["DRIVER", "TOURIST", "ADMIN"]) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO users(id,email,password_hash,role,status,name) VALUES($1,$2,'unused-test-hash',$3,'APPROVED',$3)",
      [id, `${id}@example.test`, role],
    );
    people.push({ id, role });
  }
  [owner, outsider, admin] = people;
  app = createApp({ db, secret, rateLimits: false });
});
afterAll(async () => {
  await db?.close();
  if (oldDirectory === undefined) delete process.env.LOCAL_MEDIA_DIR;
  else process.env.LOCAL_MEDIA_DIR = oldDirectory;
});
test("local private documents persist and require a short-lived owner or audited admin link", async () => {
  const uploaded = await request(app)
    .post("/media")
    .set("Authorization", bearer(owner))
    .field("kind", "DOCUMENT")
    .attach("file", png, "licence.png");
  expect(uploaded.status).toBe(201);
  const id = uploaded.body.data.id;
  expect(await fs.readFile(path.join(directory, "images", id))).toEqual(png);
  expect((await request(app).get(`/media/${id}/image`)).status).toBe(404);
  expect((await post(outsider, `/media/${id}/view`, {})).status).toBe(404);
  expect((await post(admin, `/media/${id}/view`, {})).status).toBe(400);
  const own = await post(owner, `/media/${id}/view`, {});
  expect(own.status).toBe(200);
  const image = await request(app).get(imagePath(own.body.data.url));
  expect(image.status).toBe(200);
  expect(image.headers["cache-control"]).toBe("no-store");
  expect(image.body).toEqual(png);
  const reviewed = await post(admin, `/media/${id}/view`, {
    reason: "Verify driving licence",
  });
  expect(reviewed.status).toBe(200);
  expect(
    (await request(app).get(imagePath(reviewed.body.data.url))).status,
  ).toBe(200);
  const logs = (
    await db.query(
      "SELECT action,reason FROM audit_logs WHERE resource_id=$1 AND action='ADMIN_DOCUMENT_VIEW'",
      [id],
    )
  ).rows;
  expect(logs).toEqual([
    { action: "ADMIN_DOCUMENT_VIEW", reason: "Verify driving licence" },
  ]);
  const expired = jwt.sign({ media: id, ver: 0 }, secret, {
    subject: owner.id,
    issuer: "rentmate",
    audience: "rentmate-media",
    expiresIn: -1,
  });
  expect(
    (await request(app).get(`/media/${id}/image?access_token=${expired}`))
      .status,
  ).toBe(404);
  await db.query("UPDATE users SET token_version=1 WHERE id=$1", [owner.id]);
  expect((await request(app).get(imagePath(own.body.data.url))).status).toBe(
    404,
  );
});
test("local photos are anonymous only after photo review and owner approval; invalid bytes are rejected", async () => {
  await db.query(
    "UPDATE users SET token_version=0,status='APPROVED' WHERE id=$1",
    [owner.id],
  );
  const invalid = await request(app)
    .post("/media")
    .set("Authorization", bearer(owner))
    .field("kind", "PROFILE_PHOTO")
    .attach("file", Buffer.from("not an image"), "fake.png");
  expect(invalid.status).toBe(400);
  const upload = await request(app)
    .post("/media")
    .set("Authorization", bearer(owner))
    .field("kind", "PROFILE_PHOTO")
    .attach("file", png, "portrait.png");
  expect(upload.status).toBe(201);
  const id = upload.body.data.id;
  expect((await request(app).get(`/media/${id}/image`)).status).toBe(404);
  expect(
    (
      await request(app)
        .patch(`/admin/media/${id}`)
        .set("Authorization", bearer(admin))
        .send({ reason: "Approve public portrait" })
    ).status,
  ).toBe(200);
  expect((await request(app).get(`/media/${id}/image`)).status).toBe(200);
  const onWifi = await request(app)
    .get("/me")
    .set("Host", "192.168.1.20:3000")
    .set("Authorization", bearer(owner));
  expect(onWifi.body.data.photo_url).toBe(
    `http://192.168.1.20:3000/media/${id}/image`,
  );
  const onHotspot = await request(app)
    .get("/me")
    .set("Host", "192.168.43.1:3000")
    .set("Authorization", bearer(owner));
  expect(onHotspot.body.data.photo_url).toBe(
    `http://192.168.43.1:3000/media/${id}/image`,
  );
  expect(
    (await db.query("SELECT url FROM media WHERE id=$1", [id])).rows[0].url,
  ).toBe(`/media/${id}/image`);
  await db.query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [owner.id]);
  expect((await request(app).get(`/media/${id}/image`)).status).toBe(404);
});
