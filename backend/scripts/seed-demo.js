require("dotenv").config({ quiet: true });
const { randomUUID, randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { createDatabase } = require("../src/db");
const { audit, notify } = require("../src/domain");
async function seedDemo(db) {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seed is development only");
  const credentials = [];
  await db.transaction(async (c) => {
    for (const [role, name, slug] of [
      ["ADMIN", "Demo administrator", "admin"],
      ["TOURIST", "Anna Demo", "tourist"],
      ["AGENT", "Ceylon Trails Demo", "agent"],
      ["DRIVER", "Dilshan Demo", "driver1"],
      ["DRIVER", "Nuwan Demo", "driver2"],
    ]) {
      const id = randomUUID();
      const email = `${slug}@rentmate.example.test`;
      const password = randomBytes(18).toString("base64url");
      await c.query(
        "INSERT INTO users(id,email,password_hash,role,status,name,phone,bio) VALUES($1,$2,$3,$4,'APPROVED',$5,'+94000000000','Fictional development demo account')",
        [id, email, await bcrypt.hash(password, 12), role, name],
      );
      if (role === "AGENT")
        await c.query(
          "INSERT INTO agent_profiles(user_id,agency_name,location) VALUES($1,$2,$3)",
          [id, name, "Galle"],
        );
      if (role === "DRIVER")
        await c.query(
          "INSERT INTO driver_profiles(user_id,licence_number) VALUES($1,'DEMO-ONLY')",
          [id],
        );
      credentials.push({ id, email, password, role });
      await audit(
        c,
        id,
        "DEVELOPMENT_SEED",
        id,
        "Fictional local demonstrator data",
      );
    }
    const agent = credentials[2],
      tourist = credentials[1];
    for (const [index, driver] of credentials.slice(3).entries()) {
      await c.query(
        "INSERT INTO memberships(id,agent_id,driver_id,status) VALUES($1,$2,$3,'ACCEPTED')",
        [randomUUID(), agent.id, driver.id],
      );
      await c.query(
        "INSERT INTO vehicles(id,driver_id,type,registration,model,seats,approved) VALUES($1,$2,$3,$4,'Toyota demo van',9,true)",
        [randomUUID(), driver.id, index ? "KDH" : "VAN", `DEMO-${index + 1}`],
      );
    }
    for (const [index, status] of ["REQUESTED", "OPEN"].entries()) {
      const id = randomUUID();
      const start = new Date(Date.now() + (index + 3) * 86400000),
        end = new Date(+start + 4 * 3600000);
      await c.query(
        "INSERT INTO tours(id,tourist_id,agent_id,pickup,destination,starts_at,ends_at,vehicle_type,passengers,status,notes,payout_minor,collector,collection_minor,instructions) VALUES($1,$2,$3,'Mirissa demo hotel','Ella',$4,$5,'VAN',3,$6,'Fictional development booking',$7,$8,$9,'Contact the agent at pickup')",
        [
          id,
          tourist.id,
          agent.id,
          start,
          end,
          status,
          status === "OPEN" ? 1200000 : null,
          status === "OPEN" ? "DRIVER" : null,
          status === "OPEN" ? 1500000 : null,
        ],
      );
      if (status === "OPEN")
        await c.query(
          "INSERT INTO quotes(id,tour_id,total_minor,deposit_minor,terms,status) VALUES($1,$2,2000000,500000,'Demo booking terms','ACCEPTED')",
          [randomUUID(), id],
        );
      await audit(c, agent.id, "DEVELOPMENT_TOUR_SEEDED", id);
      await notify(c, agent.id, "A demo tour is ready to review", id);
    }
  });
  return credentials;
}
if (require.main === module) {
  const db = createDatabase(process.env.DATABASE_URL);
  (async () => {
    const output = path.resolve(__dirname, "../../.local/demo-accounts.json");
    try {
      await fs.access(output);
      throw new Error("Demo credential file exists; refusing to overwrite it");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const credentials = await seedDemo(db);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    console.log(
      `Demo records created. Private generated credentials saved to ${output}`,
    );
  })()
    .catch((e) => {
      console.error(
        e.code === "23505"
          ? "Demo accounts already exist. No records changed."
          : e.message,
      );
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
module.exports = { seedDemo };
