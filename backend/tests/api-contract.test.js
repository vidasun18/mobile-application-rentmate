const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { createApp } = require("../src/app");
test("OpenAPI documents every registered operation and Postman provides request bodies", () => {
  execFileSync(process.execPath, [
    path.join(__dirname, "../scripts/generate-api-docs.js"),
  ]);
  const spec = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../docs/openapi.json"), "utf8"),
  );
  const collection = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../docs/RentMate.postman_collection.json"),
      "utf8",
    ),
  );
  const app = createApp({
    db: {},
    secret: "isolated-documentation-contract-test-secret",
    rateLimits: false,
  });
  let operations = 0;
  for (const layer of app.router.stack) {
    if (!layer.route) continue;
    const route = layer.route;
    const url = route.path.replace(/:(\w+)/g, "{$1}");
    for (const method of Object.keys(route.methods)) {
      expect(spec.paths[url]?.[method]).toBeDefined();
      operations++;
    }
  }
  expect(collection.item).toHaveLength(operations);
  for (const item of collection.item) {
    if (
      item.request.method === "POST" &&
      item.request.description.includes("schema:")
    )
      expect(item.request.body).toBeDefined();
  }
});
