require("dotenv").config();
const { randomUUID, randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { createDatabase } = require("../src/db");
const { audit } = require("../src/domain");
async function main() {
  const email = z.email().parse(process.env.PROVISION_EMAIL).toLowerCase();
  const password = z
    .string()
    .min(12)
    .max(72)
    .parse(
      process.env.PROVISION_PASSWORD || randomBytes(20).toString("base64url"),
    );
  const role = z
    .enum(["ADMIN", "TOURIST", "AGENT", "DRIVER"])
    .parse(process.env.PROVISION_ROLE || "ADMIN");
  if (process.env.NODE_ENV === "production" && role !== "ADMIN")
    throw new Error("Demo provisioning is development only");
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    const id = randomUUID();
    const hash = await bcrypt.hash(password, 12);
    await db.transaction(async (c) => {
      await c.query(
        "INSERT INTO users(id,email,password_hash,role,status,name,phone) VALUES($1,$2,$3,$4,'APPROVED',$5,$6)",
        [
          id,
          email,
          hash,
          role,
          process.env.PROVISION_NAME || "RentMate administrator",
          process.env.PROVISION_PHONE || "",
        ],
      );
      if (role === "AGENT")
        await c.query(
          "INSERT INTO agent_profiles(user_id,agency_name) VALUES($1,$2)",
          [id, process.env.PROVISION_NAME || "Demo agency"],
        );
      if (role === "DRIVER")
        await c.query("INSERT INTO driver_profiles(user_id) VALUES($1)", [id]);
      await audit(
        c,
        id,
        "ACCOUNT_PROVISIONED",
        id,
        "Local operator provisioned account",
      );
    });
    console.log(`Provisioned ${role}: ${email}`);
    if (!process.env.PROVISION_PASSWORD)
      console.log(`One-time generated password: ${password}`);
  } finally {
    await db.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
