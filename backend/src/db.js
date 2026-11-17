const { Pool } = require("pg");
function createDatabase(connectionString) {
  if (connectionString?.startsWith("sqlite:")) {
    return require("./sqlite-db").createSqliteDatabase(
      connectionString.slice(7),
    );
  }
  if (!connectionString)
    throw new Error(
      "Set DATABASE_URL or run npm run local for a local SQLite database",
    );
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
  return {
    dialect: "postgres",
    query: (sql, args) => pool.query(sql, args),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
module.exports = { createDatabase };
