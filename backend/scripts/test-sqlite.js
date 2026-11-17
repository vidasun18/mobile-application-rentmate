const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
async function main() {
  const local = path.resolve(__dirname, "../../.local");
  await fs.mkdir(local, { recursive: true });
  const directory = await fs.mkdtemp(path.join(local, "sqlite-test-"));
  const child = spawn(
    process.execPath,
    [
      require.resolve("jest/bin/jest"),
      "--runInBand",
      "--json",
      "--outputFile=../docs/sqlite-test-results.json",
    ],
    {
      stdio: "inherit",
      windowsHide: true,
      env: {
        ...process.env,
        TEST_DATABASE_URL: `sqlite:${path.join(directory, "test.db")}`,
        NODE_ENV: "test",
      },
    },
  );
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code ? reject(new Error(`Jest failed: ${code}`)) : resolve(),
    );
  });
  console.log(
    "SQLite file tests passed; isolated .local/sqlite-test-* database retained for diagnostics.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
