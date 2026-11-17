// Real PostgreSQL binaries; never use an in-memory database for locking tests.
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const { createDatabase } = require("../src/db");
async function freePort() {
  const net = require("node:net");
  const s = net.createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}
async function main() {
  if (process.env.TEST_DATABASE_URL) return run(process.env.TEST_DATABASE_URL);
  console.log("Preparing real isolated PostgreSQL tests");
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const binaries = await import(
    `@embedded-postgres/${platform}-${process.arch}`
  );
  const local = path.resolve(__dirname, "../../.local");
  await fs.mkdir(local, { recursive: true });
  const dir = await fs.mkdtemp(path.join(local, "pg-test-"));
  const passfile = path.join(dir, "password.tmp");
  const data = path.join(dir, "data");
  const password = randomBytes(24).toString("hex");
  const port = await freePort();
  await fs.writeFile(passfile, password, { mode: 0o600 });
  let started = false;
  try {
    await execute(
      binaries.initdb,
      [
        "-D",
        data,
        "-U",
        "rentmate_test",
        "--auth=scram-sha-256",
        `--pwfile=${passfile}`,
        "--encoding=UTF8",
        "--locale=C",
        "--no-sync",
      ],
      { windowsHide: true, timeout: 60000 },
    );
    await fs.unlink(passfile);
    // pg_ctl uses a restricted Windows token when invoked by an administrator.
    await execute(
      binaries.pg_ctl,
      [
        "-D",
        data,
        "-l",
        path.join(dir, "server.log"),
        "-w",
        "-t",
        "30",
        "-o",
        `-p ${port} -h 127.0.0.1`,
        "start",
      ],
      { windowsHide: true, timeout: 40000 },
    );
    started = true;
    const control = createDatabase(
      `postgresql://rentmate_test:${password}@127.0.0.1:${port}/postgres`,
    );
    try {
      await control.query("CREATE DATABASE rentmate_test");
    } finally {
      await control.close();
    }
    await run(
      `postgresql://rentmate_test:${password}@127.0.0.1:${port}/rentmate_test`,
    );
  } finally {
    await fs.unlink(passfile).catch(() => {});
    if (started)
      await execute(binaries.pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"], {
        windowsHide: true,
        timeout: 30000,
      });
    console.log(
      "Isolated PostgreSQL stopped; ignored .local cluster retained for diagnostics.",
    );
  }
}
function run(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve("jest/bin/jest"),
        "--runInBand",
        "--json",
        "--outputFile=../docs/backend-test-results.json",
      ],
      {
        stdio: "inherit",
        windowsHide: true,
        env: { ...process.env, TEST_DATABASE_URL: url, NODE_ENV: "test" },
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code) reject(new Error(`Jest failed with exit code ${code}`));
      else resolve();
    });
  });
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
