const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");
const { schemas } = require("../src/validation");
const root = path.resolve(__dirname, "../../docs");
const routes = [
  ["get", "/health", null, "Public", "Readiness"],
  [
    "post",
    "/auth/register",
    "register",
    "Public",
    "Register tourist, agent or driver",
  ],
  ["post", "/auth/login", "login", "Public", "Sign in"],
  [
    "post",
    "/auth/logout",
    null,
    "All",
    "Revoke all user sessions and push tokens",
  ],
  ["get", "/me", null, "All", "Own profile"],
  [
    "get",
    "/me/history",
    null,
    "TOURIST, AGENT, DRIVER",
    "Own historical trip summaries, with revoked assignments frozen",
  ],
  [
    "get",
    "/me/dashboard",
    null,
    "AGENT",
    "Tour counts, pending applications and unread alerts",
  ],
  ["put", "/me", "profile", "All", "Edit own profile"],
  ["get", "/vehicles", null, "DRIVER", "Own vehicles"],
  ["post", "/vehicles", "vehicle", "DRIVER", "Register vehicle"],
  [
    "put",
    "/vehicles/{id}",
    "vehicle",
    "DRIVER",
    "Edit unused vehicle and reset approval",
  ],
  ["get", "/agents", null, "TOURIST, DRIVER", "Search verified agents"],
  ["get", "/agencies/members", null, "AGENT, DRIVER", "Own agency memberships"],
  ["post", "/agencies/{id}/apply", null, "DRIVER", "Apply to agency"],
  [
    "patch",
    "/agencies/members/{id}",
    "membership",
    "AGENT",
    "Review or remove own membership",
  ],
  ["get", "/tours", null, "TOURIST, AGENT, DRIVER", "Role-filtered tour list"],
  [
    "get",
    "/tours/{id}",
    null,
    "TOURIST, AGENT, DRIVER",
    "Role-filtered tour detail",
  ],
  ["post", "/tours", "request", "TOURIST", "Request tour"],
  ...Object.entries({
    quote: ["quote", "AGENT", "Quote request"],
    accept: ["accept", "TOURIST", "Accept or decline quote"],
    post: ["post", "AGENT", "Post accepted tour"],
    deposit: ["accept", "AGENT", "Record whether deposit was received"],
    interest: [
      "interest",
      "DRIVER",
      "Express interest; acknowledge overlap warning explicitly",
    ],
    assign: ["assign", "AGENT", "Atomically assign interested eligible driver"],
    send: ["send", "AGENT", "Audited idempotent release"],
    contact: ["send", "AGENT", "Audited contact release or revocation"],
    acknowledge: [null, "DRIVER", "Acknowledge latest released details"],
    withdraw: ["reason", "DRIVER", "Notify agent of withdrawal"],
    reopen: ["reason", "AGENT", "Revoke assignment and reopen"],
    status: ["status", "DRIVER", "Start or complete acknowledged trip"],
    cancel: ["reason", "TOURIST, AGENT", "Cancel before departure"],
    changes: ["change", "TOURIST", "Request change"],
    rating: ["rating", "TOURIST, AGENT", "Rate completed trip"],
    settlement: ["settlement", "AGENT", "Record exact agreed settlement"],
  }).map(([key, [schema, role, summary]]) => [
    "post",
    `/tours/{id}/${key}`,
    schema,
    role,
    summary,
  ]),
  [
    "get",
    "/tours/{id}/interests",
    null,
    "AGENT",
    "Review interested driver cards",
  ],
  ["get", "/tours/{id}/preview", null, "AGENT", "Preview both release cards"],
  [
    "post",
    "/tours/{id}/changes/{changeId}/review",
    "reviewChange",
    "AGENT",
    "Approve structured update or reject",
  ],
  [
    "post",
    "/tours/{id}/settlement/confirm",
    null,
    "AGENT, DRIVER",
    "Confirm own settlement side",
  ],
  ["get", "/settlements", null, "AGENT, DRIVER", "Own settlement records"],
  ["get", "/ratings/me", null, "All", "Own received ratings"],
  ["get", "/notifications", null, "All", "Own inbox"],
  ["patch", "/notifications/{id}", null, "All", "Mark own notification read"],
  [
    "post",
    "/notifications/push-token",
    "pushToken",
    "All",
    "Register device token",
  ],
  [
    "delete",
    "/notifications/push-token",
    "pushToken",
    "All",
    "Unregister device token",
  ],
  ["get", "/admin/users", null, "ADMIN", "Public verification queue by status"],
  [
    "patch",
    "/admin/users/{id}",
    "verification",
    "ADMIN",
    "Verify, reject or suspend",
  ],
  [
    "post",
    "/admin/users/{id}/details",
    "reason",
    "ADMIN",
    "Audited private account read",
  ],
  [
    "patch",
    "/admin/vehicles/{id}",
    "reason",
    "ADMIN",
    "Approve vehicle and photos",
  ],
  [
    "post",
    "/admin/tours/{id}/details",
    "reason",
    "ADMIN",
    "Audited private trip read",
  ],
  ["get", "/admin/audit", null, "ADMIN", "Review audit log"],
  ["get", "/media", null, "All", "Own media metadata"],
  [
    "get",
    "/media/{id}/image",
    null,
    "Public",
    "Local photo or expiring signed private image; unapproved images require an owner/admin media token",
  ],
  [
    "post",
    "/media",
    "upload",
    "DRIVER, AGENT",
    "Upload JPEG/PNG to Cloudinary",
  ],
  [
    "post",
    "/media/{id}/view",
    "reason",
    "Owner, ADMIN",
    "View own file, or audited admin view",
  ],
  ["patch", "/admin/media/{id}", "reason", "ADMIN", "Approve public photo"],
];
const spec = {
  openapi: "3.1.0",
  info: {
    title: "RentMate API",
    version: "0.1.0",
    description:
      "Agent-controlled transport. Money is integer LKR minor units. Agents/drivers need APPROVED status for business operations. All errors are {error:{code,message,details?}}; success is {data:...}. Driver responses omit total, deposit, commission and private documents. Tourist responses omit driver phone/payout/commission. Admin private reads require a reason and are audited.",
  },
  servers: [{ url: "http://localhost:3000" }],
  security: [{ bearerAuth: [] }],
  paths: {},
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {},
  },
};
for (const [key, schema] of Object.entries(schemas))
  spec.components.schemas[key] = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  });
spec.components.schemas.pushToken = {
  type: "object",
  required: ["token"],
  properties: { token: { type: "string", minLength: 20, maxLength: 4096 } },
};
spec.components.schemas.upload = {
  type: "object",
  required: ["kind", "file"],
  properties: {
    kind: { enum: ["DOCUMENT", "VEHICLE_PHOTO", "PROFILE_PHOTO"] },
    vehicle_id: { type: "string", format: "uuid" },
    file: { type: "string", format: "binary" },
  },
};
for (const [method, url, schema, role, summary] of routes) {
  const op = {
    summary,
    description: `Allowed roles: ${role}. Ownership and eligibility checked server-side.`,
    tags: [url.split("/")[1]],
    parameters: [],
    responses: {
      200: { description: "Success envelope" },
      201: { description: "Created success envelope" },
      400: { description: "Invalid input" },
      401: { description: "Missing/expired token" },
      403: { description: "Role or approval denied" },
      404: { description: "Inaccessible or missing resource" },
      409: {
        description: "Conflicting transition, duplicate or assignment race",
      },
      422: { description: "Business input rejected" },
      503: { description: "External adapter unavailable" },
    },
  };
  if (role === "Public") op.security = [];
  for (const match of url.matchAll(/\{(\w+)\}/g))
    op.parameters.push({
      in: "path",
      name: match[1],
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  if (url === "/agents")
    op.parameters.push({
      in: "query",
      name: "search",
      schema: { type: "string" },
    });
  if (url === "/admin/users")
    op.parameters.push({
      in: "query",
      name: "status",
      schema: { enum: ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] },
    });
  if (url.endsWith("/send"))
    op.parameters.push({
      in: "header",
      name: "Idempotency-Key",
      required: true,
      schema: { type: "string", minLength: 8, maxLength: 100 },
    });
  if (schema)
    op.requestBody = {
      required: url !== "/media/{id}/view",
      content: {
        [schema === "upload" ? "multipart/form-data" : "application/json"]: {
          schema: { $ref: `#/components/schemas/${schema}` },
        },
      },
    };
  (spec.paths[url] ??= {})[method] = op;
}
fs.writeFileSync(
  path.join(root, "openapi.json"),
  JSON.stringify(spec, null, 2) + "\n",
);
const collection = {
  info: {
    name: "RentMate API",
    schema:
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:3000" },
    { key: "token", value: "" },
    { key: "id", value: "" },
    ...[
      "email",
      "password",
      "agentId",
      "driverId",
      "vehicleId",
      "tourId",
      "membershipId",
      "userId",
      "mediaId",
      "notificationId",
      "changeId",
      "ratingTargetId",
      "pushToken",
    ].map((key) => ({ key, value: "" })),
  ],
  event: [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: [
          "pm.collectionVariables.set('startsAt', new Date(Date.now()+3*86400000).toISOString());",
          "pm.collectionVariables.set('endsAt', new Date(Date.now()+3*86400000+4*3600000).toISOString());",
        ],
      },
    },
  ],
  auth: {
    type: "bearer",
    bearer: [{ key: "token", value: "{{token}}", type: "string" }],
  },
  item: routes.map(([method, url, schema, role, summary]) => ({
    name: summary,
    request: {
      method: method.toUpperCase(),
      header: [
        { key: "Content-Type", value: "application/json" },
        ...(url.endsWith("/send")
          ? [{ key: "Idempotency-Key", value: "{{$guid}}" }]
          : []),
      ],
      url: `{{baseUrl}}${url.replace(/\{id\}/g, `{{${url.startsWith("/tours") ? "tourId" : url.includes("/vehicles") ? "vehicleId" : url.includes("/users") ? "userId" : url.includes("/media") ? "mediaId" : url.includes("/members") ? "membershipId" : url.startsWith("/agencies") ? "agentId" : url.startsWith("/notifications") ? "notificationId" : "id"}}}`).replace("{changeId}", "{{changeId}}")}`,
      description: `${role}. See openapi.json for exact request schema${schema ? `: ${schema}` : ""}.`,
      ...(role === "Public" ? { auth: { type: "noauth" } } : {}),
    },
  })),
};
const examples = {
  register: {
    email: "{{email}}",
    password: "{{password}}",
    role: "TOURIST",
    name: "Example tourist",
    phone: "+94000000000",
  },
  login: { email: "{{email}}", password: "{{password}}" },
  profile: { name: "Example user", phone: "+94000000000", bio: "" },
  vehicle: {
    type: "VAN",
    registration: "EXAMPLE-001",
    model: "Toyota van",
    seats: 9,
  },
  request: {
    agent_id: "{{agentId}}",
    pickup: "Mirissa hotel",
    destination: "Ella",
    starts_at: "{{startsAt}}",
    ends_at: "{{endsAt}}",
    vehicle_type: "VAN",
    passengers: 3,
    notes: "",
  },
  quote: {
    total_minor: 2000000,
    deposit_minor: 500000,
    terms: "Deposit arranged through the agent",
    currency: "LKR",
  },
  accept: { accept: true },
  post: {
    payout_minor: 1200000,
    collector: "DRIVER",
    collection_minor: 1500000,
    instructions: "Collect the agreed balance at pickup",
  },
  interest: { vehicle_id: "{{vehicleId}}", acknowledge_overlap: false },
  assign: { driver_id: "{{driverId}}" },
  send: { release_phone: false },
  reason: { reason: "Verification or safety review" },
  status: { status: "IN_PROGRESS" },
  rating: { target_id: "{{ratingTargetId}}", score: 5, comment: "" },
  settlement: { amount_minor: 300000, note: "Agreed handover" },
  membership: { status: "ACCEPTED" },
  verification: { status: "APPROVED", reason: "Identity documents reviewed" },
  change: { request: "Please change the hotel pickup location" },
  reviewChange: {
    accept: true,
    response: "Pickup change approved",
    pickup: "Updated hotel reception",
  },
  pushToken: { token: "{{pushToken}}" },
};
routes.forEach(([method, url, schema], index) => {
  const item = collection.item[index];
  if (schema === "upload") {
    item.request.header = [];
    item.request.body = {
      mode: "formdata",
      formdata: [
        { key: "kind", value: "DOCUMENT", type: "text" },
        { key: "file", type: "file", src: [] },
      ],
    };
  } else if (schema) {
    item.request.body = {
      mode: "raw",
      raw: JSON.stringify(examples[schema] || {}, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  const variable =
    url === "/auth/login" || url === "/auth/register"
      ? "token"
      : method === "post" && url === "/tours"
        ? "tourId"
        : method === "post" && url === "/vehicles"
          ? "vehicleId"
          : null;
  if (variable)
    item.event = [
      {
        listen: "test",
        script: {
          type: "text/javascript",
          exec: [
            "if (pm.response.code < 300) { const data = pm.response.json().data;",
            `pm.collectionVariables.set('${variable}',data.${variable === "token" ? "token" : "id"});`,
            "}",
          ],
        },
      },
    ];
});
fs.writeFileSync(
  path.join(root, "RentMate.postman_collection.json"),
  JSON.stringify(collection, null, 2) + "\n",
);
console.log(`Documented ${routes.length} operations`);
