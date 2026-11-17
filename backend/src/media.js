const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { randomUUID } = require("node:crypto");
const { requireThat, AppError } = require("./errors");
const { uuid } = require("./validation");
const { audit } = require("./domain");
const local = require("./local-media");
module.exports = (app, { db, ok, roles, secret }) => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  app.get("/media", async (req, res) =>
    ok(
      res,
      (
        await db.query(
          "SELECT id,kind,vehicle_id,url,approved,created_at FROM media WHERE owner_id=$1 ORDER BY created_at DESC",
          [req.user.id],
        )
      ).rows,
    ),
  );
  app.post(
    "/media",
    roles("DRIVER", "AGENT"),
    upload.single("file"),
    async (req, res) => {
      requireThat(
        !["SUSPENDED", "REJECTED"].includes(req.user.status),
        403,
        "ACCOUNT_UNAVAILABLE",
        "Account unavailable",
      );
      requireThat(
        process.env.CLOUDINARY_URL || process.env.LOCAL_MEDIA_DIR,
        503,
        "MEDIA_UNAVAILABLE",
        "Media storage is not configured. No upload was saved.",
      );
      const kind = req.body.kind;
      requireThat(
        ["DOCUMENT", "VEHICLE_PHOTO", "PROFILE_PHOTO"].includes(kind),
        400,
        "MEDIA_KIND",
        "Choose a supported media kind",
      );
      const bytes = req.file?.buffer;
      const isPng = bytes
        ?.subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isJpeg =
        bytes?.[0] === 255 && bytes?.[1] === 216 && bytes?.[2] === 255;
      requireThat(
        bytes && (isPng || isJpeg),
        400,
        "IMAGE_REQUIRED",
        "Upload a JPEG or PNG image",
      );
      let vehicle = null;
      if (kind === "VEHICLE_PHOTO") {
        uuid.parse(req.body.vehicle_id);
        vehicle = (
          await db.query(
            "SELECT id FROM vehicles WHERE id=$1 AND driver_id=$2",
            [req.body.vehicle_id, req.user.id],
          )
        ).rows[0];
        requireThat(vehicle, 404, "NOT_FOUND", "Vehicle not found");
      }
      const id = randomUUID();
      let asset;
      try {
        if (process.env.LOCAL_MEDIA_DIR)
          asset = await local.saveLocal(req, id, bytes, kind);
        else {
          cloudinary.config({ secure: true });
          asset = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                public_id: `rentmate/${id}`,
                resource_type: "image",
                type: kind === "DOCUMENT" ? "authenticated" : "upload",
                overwrite: false,
              },
              (err, result) => (err ? reject(err) : resolve(result)),
            );
            stream.end(bytes);
          });
        }
      } catch {
        throw new AppError(
          503,
          "MEDIA_FAILED",
          "Upload service failed. Please try again.",
        );
      }
      try {
        await db.transaction(async (c) => {
          await c.query(
            "INSERT INTO media(id,owner_id,vehicle_id,kind,public_id,url) VALUES($1,$2,$3,$4,$5,$6)",
            [
              id,
              req.user.id,
              vehicle?.id || null,
              kind,
              asset.public_id,
              kind === "DOCUMENT" ? null : asset.secure_url,
            ],
          );
          if (kind === "DOCUMENT")
            await c.query("UPDATE users SET status='PENDING' WHERE id=$1", [
              req.user.id,
            ]);
          // Profile images are published only after admin review.
          await audit(c, req.user.id, "MEDIA_UPLOADED", id);
        });
      } catch (error) {
        if (asset.public_id.startsWith("local/")) await local.removeLocal(id);
        else
          await cloudinary.uploader
            .destroy(asset.public_id, {
              type: kind === "DOCUMENT" ? "authenticated" : "upload",
            })
            .catch(() => {});
        throw error;
      }
      ok(res, { id, kind, approved: false }, 201);
    },
  );
  app.post("/media/:id/view", async (req, res) => {
    uuid.parse(req.params.id);
    const m = (
      await db.query("SELECT * FROM media WHERE id=$1", [req.params.id])
    ).rows[0];
    requireThat(
      m &&
        (m.owner_id === req.user.id ||
          (req.user.role === "ADMIN" && req.user.status === "APPROVED")),
      404,
      "NOT_FOUND",
      "Media not found",
    );
    if (req.user.role === "ADMIN" && m.owner_id !== req.user.id) {
      requireThat(
        typeof req.body.reason === "string" &&
          req.body.reason.trim().length >= 5 &&
          req.body.reason.length <= 1000,
        400,
        "REASON_REQUIRED",
        "Record why you need this private file",
      );
      await audit(
        db,
        req.user.id,
        "ADMIN_DOCUMENT_VIEW",
        m.id,
        req.body.reason,
      );
    }
    if (m.public_id.startsWith("local/")) {
      requireThat(
        process.env.LOCAL_MEDIA_DIR,
        503,
        "MEDIA_UNAVAILABLE",
        "Local media storage is not configured",
      );
      res.set("Cache-Control", "no-store");
      return ok(res, {
        url: local.privateUrl(req, m, secret),
        expires_in_seconds: 60,
      });
    }
    if (m.kind !== "DOCUMENT") return ok(res, { url: m.url });
    requireThat(
      process.env.CLOUDINARY_URL,
      503,
      "MEDIA_UNAVAILABLE",
      "Media storage is not configured",
    );
    cloudinary.config({ secure: true });
    const url = cloudinary.utils.private_download_url(m.public_id, "", {
      resource_type: "image",
      type: "authenticated",
      expires_at: Math.floor(Date.now() / 1000) + 60,
      attachment: false,
    });
    // Private signed URL is short lived, authenticated, and never returned by public profile APIs.
    res.set("Cache-Control", "no-store");
    ok(res, { url, expires_in_seconds: 60 });
  });
  app.patch("/admin/media/:id", roles("ADMIN"), async (req, res) => {
    requireThat(
      req.user.status === "APPROVED",
      403,
      "FORBIDDEN",
      "Account unavailable",
    );
    uuid.parse(req.params.id);
    requireThat(
      typeof req.body.reason === "string" && req.body.reason.trim().length >= 5,
      400,
      "REASON_REQUIRED",
      "Review reason is required",
    );
    await db.transaction(async (c) => {
      const m = (
        await c.query("SELECT * FROM media WHERE id=$1 FOR UPDATE", [
          req.params.id,
        ])
      ).rows[0];
      requireThat(
        m && m.kind !== "DOCUMENT",
        404,
        "NOT_FOUND",
        "Public photo not found",
      );
      await c.query("UPDATE media SET approved=true WHERE id=$1", [m.id]);
      if (m.kind === "PROFILE_PHOTO")
        await c.query("UPDATE users SET photo_url=$2 WHERE id=$1", [
          m.owner_id,
          m.url,
        ]);
      await audit(c, req.user.id, "PHOTO_APPROVED", m.id, req.body.reason);
    });
    ok(res, { saved: true });
  });
};
