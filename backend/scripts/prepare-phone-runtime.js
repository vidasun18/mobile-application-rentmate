const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");

async function prepareRuntime(root = path.resolve(__dirname, "../..")) {
  const local = path.join(root, ".local");
  await fs.mkdir(local, { recursive: true });
  const destination = await fs.mkdtemp(
    path.join(local, "phone-runtime-stage-"),
  );
  const backend = path.join(root, "backend");
  await fs.mkdir(path.join(destination, "backend/scripts"), {
    recursive: true,
  });
  await fs.cp(
    path.join(backend, "src"),
    path.join(destination, "backend/src"),
    { recursive: true },
  );
  await fs.cp(
    path.join(backend, "migrations/sqlite"),
    path.join(destination, "backend/migrations/sqlite"),
    { recursive: true },
  );
  for (const filename of ["phone-server.js", "migrate.js"])
    await fs.copyFile(
      path.join(backend, "scripts", filename),
      path.join(destination, "backend/scripts", filename),
    );
  const lock = JSON.parse(
    await fs.readFile(path.join(backend, "package-lock.json"), "utf8"),
  );
  const packages = [];
  for (const [relative, metadata] of Object.entries(lock.packages)) {
    if (
      !relative.startsWith("node_modules/") ||
      metadata.dev ||
      metadata.devOptional
    )
      continue;
    await fs.cp(
      path.join(backend, relative),
      path.join(destination, relative),
      { recursive: true, dereference: true },
    );
    packages.push({
      package: relative,
      version: metadata.version,
      integrity: metadata.integrity,
    });
  }
  const manifest = {
    entry: "backend/scripts/phone-server.js",
    created_at: new Date().toISOString(),
    packages,
  };
  await fs.writeFile(
    path.join(destination, "server-packages.json"),
    JSON.stringify(manifest, null, 2),
  );
  await fs.writeFile(
    path.join(destination, "package.json"),
    JSON.stringify({
      name: "rentmate-phone-runtime",
      private: true,
      type: "commonjs",
    }),
  );
  const code = await fs.readFile(path.join(destination, manifest.entry));
  return {
    directory: destination,
    entry_sha256: createHash("sha256").update(code).digest("hex"),
    packages: packages.length,
  };
}
if (require.main === module)
  prepareRuntime()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { prepareRuntime };
