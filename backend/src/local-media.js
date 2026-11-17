const fs = require("node:fs/promises");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { requireThat, AppError } = require("./errors");
const { uuid } = require("./validation");

function baseUrl(req) {
  return (
    process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`
  ).replace(/\/$/, "");
}
async function saveLocal(req, id, bytes, kind) {
  const directory = path.resolve(process.env.LOCAL_MEDIA_DIR);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, id), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  return {
    public_id: `local/${id}`,
    secure_url: kind === "DOCUMENT" ? null : `/media/${id}/image`,
  };
}
async function removeLocal(id) {
  await fs
    .unlink(path.join(path.resolve(process.env.LOCAL_MEDIA_DIR), id))
    .catch(() => {});
}
function privateUrl(req, media, secret) {
  const token = jwt.sign(
    { media: media.id, ver: req.user.token_version },
    secret,
    {
      subject: req.user.id,
      audience: "rentmate-media",
      issuer: "rentmate",
      expiresIn: 60,
      algorithm: "HS256",
    },
  );
  return `${baseUrl(req)}/media/${media.id}/image?access_token=${encodeURIComponent(token)}`;
}
function resolveLocalMedia(value, req) {
  if (Array.isArray(value))
    return value.map((item) => resolveLocalMedia(item, req));
  if (!value || typeof value !== "object" || value instanceof Date)
    return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      // Resolve local images against the current Wi-Fi or hotspot address. Existing
      // absolute local URLs are supported without rewriting the user's database.
      const local =
        ["url", "photo_url"].includes(key) && typeof item === "string"
          ? item.match(
              /^(?:https?:\/\/[^/]+)?(\/media\/[0-9a-f-]{36}\/image)$/i,
            )
          : null;
      return [
        key,
        local ? `${baseUrl(req)}${local[1]}` : resolveLocalMedia(item, req),
      ];
    }),
  );
}
function registerLocalMedia(app, { db, secret }) {
  app.get("/media/:id/image", async (req, res) => {
    uuid.parse(req.params.id);
    requireThat(
      process.env.LOCAL_MEDIA_DIR,
      404,
      "NOT_FOUND",
      "Media not found",
    );
    const m = (
      await db.query(
        "SELECT m.*,u.status AS owner_status FROM media m JOIN users u ON u.id=m.owner_id WHERE m.id=$1",
        [req.params.id],
      )
    ).rows[0];
    requireThat(
      m?.public_id === `local/${req.params.id}`,
      404,
      "NOT_FOUND",
      "Media not found",
    );
    if (
      !(m.kind !== "DOCUMENT" && m.approved && m.owner_status === "APPROVED")
    ) {
      let claims;
      try {
        claims = jwt.verify(req.query.access_token, secret, {
          algorithms: ["HS256"],
          audience: "rentmate-media",
          issuer: "rentmate",
        });
      } catch {
        throw new AppError(404, "NOT_FOUND", "Media not found");
      }
      const viewer = (
        await db.query(
          "SELECT id,role,status,token_version FROM users WHERE id=$1",
          [claims.sub],
        )
      ).rows[0];
      requireThat(
        claims.media === m.id &&
          viewer &&
          viewer.token_version === claims.ver &&
          !["SUSPENDED", "REJECTED"].includes(viewer.status) &&
          (viewer.id === m.owner_id ||
            (viewer.role === "ADMIN" && viewer.status === "APPROVED")),
        404,
        "NOT_FOUND",
        "Media not found",
      );
    }
    let bytes;
    try {
      bytes = await fs.readFile(
        path.join(path.resolve(process.env.LOCAL_MEDIA_DIR), m.id),
      );
    } catch {
      throw new AppError(404, "NOT_FOUND", "Media file not found");
    }
    res.set("Cache-Control", "no-store");
    res.type(bytes[0] === 137 ? "image/png" : "image/jpeg").send(bytes);
  });
}
module.exports = {
  saveLocal,
  removeLocal,
  privateUrl,
  registerLocalMedia,
  resolveLocalMedia,
};
