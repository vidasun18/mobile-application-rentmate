const { randomUUID } = require("node:crypto");
const { requireThat } = require("./errors");
const transitions = {
  REQUESTED: ["QUOTED", "CANCELLED"],
  QUOTED: ["QUOTED", "ACCEPTED", "CANCELLED"],
  ACCEPTED: ["OPEN", "CANCELLED"],
  OPEN: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};
function transition(tour, next) {
  requireThat(
    transitions[tour.status]?.includes(next),
    409,
    "ILLEGAL_TRANSITION",
    `Cannot move ${tour.status} to ${next}`,
  );
}
function matches(required, actual) {
  return required === actual || (required === "VAN" && actual === "KDH");
}
function tripSnapshot(tour) {
  return Object.fromEntries(
    [
      "pickup",
      "destination",
      "starts_at",
      "ends_at",
      "vehicle_type",
      "passengers",
    ].map((key) => [key, tour[key]]),
  );
}
async function audit(db, actor, action, resource, reason = "", metadata = {}) {
  await db.query(
    "INSERT INTO audit_logs(id,actor_id,action,resource_id,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), actor, action, resource, reason, JSON.stringify(metadata)],
  );
}
async function notify(db, user, title, resource, kind = "TOUR") {
  await db.query(
    "INSERT INTO notifications(id,user_id,title,resource_id,resource_kind) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), user, title, resource, kind],
  );
}
async function notifyMatching(db, tour) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id FROM memberships m JOIN users u ON u.id=m.driver_id JOIN users agent ON agent.id=m.agent_id
    JOIN vehicles v ON v.driver_id=u.id WHERE m.agent_id=$1 AND m.status='ACCEPTED' AND u.status='APPROVED' AND agent.status='APPROVED'
    AND v.approved=true AND v.seats >= $3 AND (v.type=$2 OR ($2='VAN' AND v.type='KDH'))`,
    [tour.agent_id, tour.vehicle_type, tour.passengers],
  );
  for (const driver of rows)
    await notify(db, driver.id, "A matching tour is available", tour.id);
}
async function reputation(db, id) {
  const rating = (
    await db.query(
      "SELECT round(avg(score),2) AS rating, count(*)::int AS rating_count FROM ratings WHERE target_id=$1",
      [id],
    )
  ).rows[0];
  const trips = (
    await db.query(
      `SELECT count(*)::int AS completed_trips FROM tours t WHERE status='COMPLETED' AND
    (agent_id=$1 OR EXISTS(SELECT 1 FROM assignments a WHERE a.tour_id=t.id AND a.driver_id=$1 AND a.ended_at IS NULL))`,
      [id],
    )
  ).rows[0];
  const cancelled = (
    await db.query(
      `SELECT ((SELECT count(*) FROM assignments WHERE driver_id=$1 AND (withdrawal_reason IS NOT NULL OR ended_at IS NOT NULL)) + (SELECT count(*) FROM tours WHERE agent_id=$1 AND status='CANCELLED'))::int AS cancellations`,
      [id],
    )
  ).rows[0];
  return { ...rating, ...trips, ...cancelled };
}
async function publicProfile(db, id) {
  const u = (
    await db.query(
      "SELECT id,name,photo_url,bio,status FROM users WHERE id=$1",
      [id],
    )
  ).rows[0];
  requireThat(u, 404, "NOT_FOUND", "Profile not found");
  return {
    id: u.id,
    name: u.name,
    photo_url: u.photo_url,
    bio: u.bio,
    verified: u.status === "APPROVED",
    ...(await reputation(db, id)),
  };
}
async function driverCard(db, a) {
  const vehicle = (
    await db.query(
      "SELECT id,type,registration,model,seats FROM vehicles WHERE id=$1",
      [a.vehicle_id],
    )
  ).rows[0];
  const photos = (
    await db.query(
      "SELECT id,url FROM media WHERE vehicle_id=$1 AND kind='VEHICLE_PHOTO' AND approved=true",
      [a.vehicle_id],
    )
  ).rows;
  const { bio, ...profile } = await publicProfile(db, a.driver_id);
  return {
    ...profile,
    vehicle: { ...vehicle, photos },
  };
}
async function publicVehicles(db, driver) {
  const rows = (
    await db.query(
      "SELECT id,type,registration,model,seats,approved FROM vehicles WHERE driver_id=$1 ORDER BY registration",
      [driver],
    )
  ).rows;
  for (const vehicle of rows)
    vehicle.photos = (
      await db.query(
        "SELECT id,url FROM media WHERE vehicle_id=$1 AND kind='VEHICLE_PHOTO' AND approved=true",
        [vehicle.id],
      )
    ).rows;
  return rows;
}
async function eligible(db, tour, driver, vehicle) {
  const { rows } = await db.query(
    `SELECT v.* FROM vehicles v JOIN users u ON u.id=v.driver_id JOIN memberships m ON m.driver_id=u.id
    JOIN users agent ON agent.id=m.agent_id WHERE v.id=$1 AND v.driver_id=$2 AND m.agent_id=$3 AND m.status='ACCEPTED'
    AND u.status='APPROVED' AND agent.status='APPROVED' AND v.approved=true FOR SHARE OF v,u,m,agent`,
    [vehicle, driver, tour.agent_id],
  );
  requireThat(
    rows.length &&
      matches(tour.vehicle_type, rows[0].type) &&
      rows[0].seats >= tour.passengers,
    403,
    "INELIGIBLE",
    "Driver, vehicle or membership is not eligible",
  );
}
async function activeAssignment(db, id) {
  return (
    await db.query(
      "SELECT * FROM assignments WHERE tour_id=$1 AND ended_at IS NULL",
      [id],
    )
  ).rows[0];
}
async function accessible(db, user, tour) {
  if (user.role === "AGENT") return tour.agent_id === user.id;
  if (user.role === "TOURIST") return tour.tourist_id === user.id;
  if (user.role !== "DRIVER") return false;
  const a = await activeAssignment(db, tour.id);
  if (a?.driver_id === user.id) return true;
  if (!["OPEN", "ASSIGNED"].includes(tour.status)) return false;
  // Revoked assignments cannot regain detail access merely because the tour reopens.
  if (
    (
      await db.query(
        "SELECT id FROM assignments WHERE tour_id=$1 AND driver_id=$2",
        [tour.id, user.id],
      )
    ).rows.length
  )
    return false;
  return !!(
    await db.query(
      `SELECT v.id FROM vehicles v JOIN memberships m ON m.driver_id=v.driver_id JOIN users a ON a.id=m.agent_id
    WHERE m.driver_id=$1 AND m.agent_id=$2 AND m.status='ACCEPTED' AND a.status='APPROVED' AND v.approved=true AND v.seats >= $4
    AND (v.type=$3 OR ($3='VAN' AND v.type='KDH'))`,
      [user.id, tour.agent_id, tour.vehicle_type, tour.passengers],
    )
  ).rows.length;
}
async function serializeTour(db, user, tour) {
  const out = {
    id: tour.id,
    status: tour.status,
    pickup: tour.pickup,
    destination: tour.destination,
    starts_at: tour.starts_at,
    ends_at: tour.ends_at,
    vehicle_type: tour.vehicle_type,
    passengers: tour.passengers,
    updated_at: tour.updated_at,
    agent_id: tour.agent_id,
  };
  out.agency_name = (
    await db.query("SELECT agency_name FROM agent_profiles WHERE user_id=$1", [
      tour.agent_id,
    ])
  ).rows[0]?.agency_name;
  const a = await activeAssignment(db, tour.id);
  const q = (
    await db.query(
      "SELECT id,total_minor,deposit_minor,currency,terms,status FROM quotes WHERE tour_id=$1 ORDER BY created_at DESC LIMIT 1",
      [tour.id],
    )
  ).rows[0];
  if (user.role === "TOURIST" || user.role === "AGENT") {
    out.quote = q || null;
    out.notes = tour.notes;
    out.deposit_received = tour.deposit_received;
  }
  if (user.role === "AGENT") {
    out.tourist = (
      await db.query("SELECT id,name,phone FROM users WHERE id=$1", [
        tour.tourist_id,
      ])
    ).rows[0];
    out.payout_minor = tour.payout_minor;
    out.commission_minor =
      q && tour.payout_minor != null
        ? String(BigInt(q.total_minor) - BigInt(tour.payout_minor))
        : null;
    out.assignment = a
      ? {
          id: a.id,
          driver_id: a.driver_id,
          sent_at: a.sent_at,
          acknowledged_at: a.acknowledged_at,
          release_phone: a.release_phone,
          withdrawal_reason: a.withdrawal_reason,
          card: await driverCard(db, a),
          phone: (
            await db.query("SELECT phone FROM users WHERE id=$1", [a.driver_id])
          ).rows[0].phone,
        }
      : null;
    out.collector = tour.collector;
    out.collection_minor = tour.collection_minor;
    out.instructions = tour.instructions;
  }
  if (user.role === "TOURIST" && a?.sent_at)
    out.driver_card = await driverCard(db, a);
  if (user.role === "DRIVER") {
    out.payout_minor = tour.payout_minor;
    out.is_assigned = a?.driver_id === user.id;
    out.is_taken = !!a;
    out.interested = !!(
      await db.query(
        "SELECT 1 FROM interests WHERE tour_id=$1 AND driver_id=$2",
        [tour.id, user.id],
      )
    ).rows.length;
    if (a?.driver_id === user.id) {
      out.sent_at = a.sent_at;
      out.acknowledged_at = a.acknowledged_at;
      out.withdrawal_reason = a.withdrawal_reason;
      if (a.sent_at) {
        const tourist = (
          await db.query("SELECT name,phone FROM users WHERE id=$1", [
            tour.tourist_id,
          ])
        ).rows[0];
        out.tourist_first_name = tourist.name.trim().split(/\s+/)[0];
        if (a.release_phone) out.tourist_phone = tourist.phone;
        out.instructions = tour.instructions;
        if (tour.collector === "DRIVER") {
          out.collection_minor = tour.collection_minor;
          out.payable_to_agent_minor = String(
            BigInt(tour.collection_minor) - BigInt(tour.payout_minor),
          );
        }
      }
    }
  }
  if (user.role !== "DRIVER" || (a?.driver_id === user.id && a.sent_at)) {
    out.changes = (
      await db.query(
        "SELECT id,request,status,response,created_at,acknowledged_at FROM changes WHERE tour_id=$1 ORDER BY created_at",
        [tour.id],
      )
    ).rows;
  }
  if (
    user.role === "AGENT" ||
    (user.role === "DRIVER" && a?.driver_id === user.id)
  ) {
    out.settlement =
      (await db.query("SELECT * FROM settlements WHERE tour_id=$1", [tour.id]))
        .rows[0] || null;
    if (out.settlement)
      out.settlement.history = (
        await db.query(
          "SELECT action,created_at FROM settlement_events WHERE settlement_id=$1 ORDER BY created_at",
          [out.settlement.id],
        )
      ).rows;
  }
  return out;
}
module.exports = {
  transition,
  matches,
  tripSnapshot,
  audit,
  notify,
  notifyMatching,
  reputation,
  publicProfile,
  driverCard,
  publicVehicles,
  eligible,
  activeAssignment,
  accessible,
  serializeTour,
};
