require("dotenv").config();
const pino = require("pino");
const { createDatabase } = require("./db");
const { createApp } = require("./app");
const { deliverPush } = require("./push");
const logger = pino({
  redact: ["password", "password_hash", "token", "secret"],
});
const db = createDatabase(process.env.DATABASE_URL);
const app = createApp({
  db,
  secret: process.env.JWT_SECRET,
  ttl: process.env.JWT_TTL || "8h",
  logger,
});
const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  logger.info(
    { port: Number(process.env.PORT || 3000) },
    "RentMate API started",
  ),
);
let delivering = false;
const interval = setInterval(async () => {
  if (delivering) return;
  delivering = true;
  try {
    await deliverPush(db, logger);
  } catch (error) {
    logger.warn({ code: error.code }, "Notification worker unavailable");
  } finally {
    delivering = false;
  }
}, 30000);
async function shutdown() {
  clearInterval(interval);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
