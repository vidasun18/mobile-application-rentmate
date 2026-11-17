const { z } = require("zod");
const text = z.string().trim().min(1).max(500);
const uuid = z.uuid();
const money = z.number().int().min(0).max(10000000000);
const vehicleType = z.enum(["CAR", "VAN", "KDH"]);
const interval = {
  starts_at: z.iso
    .datetime({ offset: true })
    .transform((s) => new Date(s).toISOString()),
  ends_at: z.iso
    .datetime({ offset: true })
    .transform((s) => new Date(s).toISOString()),
};
const schemas = {
  register: z
    .object({
      email: z
        .email()
        .max(254)
        .transform((s) => s.toLowerCase()),
      password: z
        .string()
        .min(12)
        .max(72)
        .refine(
          (s) => Buffer.byteLength(s, "utf8") <= 72,
          "Password is too long in bytes",
        ),
      role: z.enum(["TOURIST", "AGENT", "DRIVER"]),
      name: text,
      phone: z.string().trim().min(7).max(25),
      agency_name: text.optional(),
    })
    .strict(),
  login: z
    .object({
      email: z.email().transform((s) => s.toLowerCase()),
      password: z.string().min(1).max(72),
    })
    .strict(),
  profile: z
    .object({
      name: text,
      phone: z.string().trim().min(7).max(25),
      bio: z.string().max(1000).default(""),
      licence_number: z.string().max(60).optional(),
      licence_expiry: z.iso.date().optional(),
      agency_name: text.optional(),
      location: text.optional(),
    })
    .strict(),
  vehicle: z
    .object({
      type: vehicleType,
      registration: z
        .string()
        .trim()
        .min(3)
        .max(30)
        .transform((s) => s.toUpperCase()),
      model: text,
      seats: z.number().int().min(1).max(60),
    })
    .strict(),
  request: z
    .object({
      agent_id: uuid,
      pickup: text,
      destination: text,
      ...interval,
      vehicle_type: vehicleType,
      passengers: z.number().int().min(1).max(60),
      notes: z.string().max(2000).default(""),
    })
    .strict()
    .refine(
      (x) =>
        new Date(x.ends_at) > new Date(x.starts_at) &&
        new Date(x.starts_at) > new Date(),
      "Choose future times with end after pickup",
    ),
  quote: z
    .object({
      total_minor: money.positive(),
      deposit_minor: money,
      terms: text,
      currency: z.literal("LKR").default("LKR"),
    })
    .strict()
    .refine((x) => x.deposit_minor <= x.total_minor, "Deposit exceeds price"),
  accept: z.object({ accept: z.boolean() }).strict(),
  post: z
    .object({
      payout_minor: money,
      collector: z.enum(["AGENT", "DRIVER"]),
      collection_minor: money,
      instructions: z.string().max(2000).default(""),
    })
    .strict(),
  interest: z
    .object({
      vehicle_id: uuid,
      acknowledge_overlap: z.boolean().default(false),
    })
    .strict(),
  assign: z.object({ driver_id: uuid }).strict(),
  send: z.object({ release_phone: z.boolean().default(false) }).strict(),
  reason: z.object({ reason: z.string().trim().min(5).max(1000) }).strict(),
  status: z.object({ status: z.enum(["IN_PROGRESS", "COMPLETED"]) }).strict(),
  rating: z
    .object({
      target_id: uuid,
      score: z.number().int().min(1).max(5),
      comment: z.string().max(1000).default(""),
    })
    .strict(),
  settlement: z
    .object({ amount_minor: money, note: z.string().max(1000).default("") })
    .strict(),
  membership: z
    .object({ status: z.enum(["ACCEPTED", "REJECTED", "REMOVED"]) })
    .strict(),
  verification: z
    .object({
      status: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict(),
  change: z.object({ request: text }).strict(),
  reviewChange: z
    .object({
      accept: z.boolean(),
      response: text,
      pickup: text.optional(),
      ...Object.fromEntries(
        Object.entries(interval).map(([k, v]) => [k, v.optional()]),
      ),
    })
    .strict(),
};
module.exports = { schemas, uuid };
