const { DatabaseSync } = require("node:sqlite");
const { mkdirSync } = require("node:fs");
const path = require("node:path");

const booleanColumns = new Set([
  "approved",
  "release_phone",
  "deposit_received",
]);
const jsonColumns = new Set(["metadata", "trip_snapshot"]);
function normalizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value === null
        ? null
        : booleanColumns.has(key)
          ? Boolean(value)
          : jsonColumns.has(key)
            ? JSON.parse(value)
            : key.endsWith("_minor")
              ? String(value)
              : value,
    ]),
  );
}
function parameter(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return Number(value);
  return value ?? null;
}

// Only application-owned SQL reaches this adapter. Values stay bound parameters.
// SQLite serializes writers with BEGIN IMMEDIATE; PostgreSQL retains row locks.
function translate(sql, args) {
  const values = [];
  const query = sql
    .replace(
      /\bFOR\s+(?:UPDATE(?:\s+SKIP\s+LOCKED)?|SHARE(?:\s+OF\s+[\w,]+)?)\s*$/i,
      "",
    )
    .replace(/::(?:int(?:eger)?|timestamptz)\b/gi, "")
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(
      /now\(\)\s*\+\s*interval\s*'5 minutes'/gi,
      "strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes')",
    )
    .replace(/\bnow\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    .replace(/\$(\d+)/g, (_, n) => {
      values.push(parameter(args[Number(n) - 1]));
      return "?";
    });
  return { query, values };
}
function mapError(error) {
  const codes = {
    1555: "23505",
    2067: "23505",
    787: "23503",
    275: "23514",
    1299: "23514",
  };
  if (codes[error.errcode]) error.code = codes[error.errcode];
  return error;
}
function createSqliteDatabase(filename) {
  if (filename !== ":memory:")
    mkdirSync(path.dirname(filename), { recursive: true });
  const connection = new DatabaseSync(filename);
  connection.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  let tail = Promise.resolve();
  let closed = false;
  function serialize(action) {
    const result = tail.then(() => {
      if (closed) throw new Error("Database is closed");
      return action();
    });
    tail = result.catch(() => {});
    return result;
  }
  async function query(sql, args = []) {
    try {
      const translated = translate(sql, args);
      // Native migration scripts contain several DDL statements and no values.
      if (
        !args.length &&
        /;\s*\S/.test(translated.query.trim().replace(/;$/, ""))
      ) {
        connection.exec(translated.query);
        return { rows: [] };
      }
      const statement = connection.prepare(translated.query);
      return { rows: statement.all(...translated.values).map(normalizeRow) };
    } catch (error) {
      throw mapError(error);
    }
  }
  return {
    dialect: "sqlite",
    query: (sql, args) => serialize(() => query(sql, args)),
    transaction: (fn) =>
      serialize(async () => {
        connection.exec("BEGIN IMMEDIATE");
        try {
          const result = await fn({ query });
          connection.exec("COMMIT");
          return result;
        } catch (error) {
          connection.exec("ROLLBACK");
          throw error;
        }
      }),
    close: () =>
      serialize(() => {
        connection.close();
        closed = true;
      }),
  };
}
module.exports = { createSqliteDatabase };
