import { sql } from '@payloadcms/db-postgres'
import { drizzle } from '@payloadcms/db-postgres/drizzle/node-postgres'

/**
 * Vitest global setup for `pnpm test:postgres`: creates two empty databases on the Postgres
 * server that DATABASE_URI points at, one for each Payload config the tests use, points
 * DATABASE_URI at the first before the test workers start, and drops both after the run.
 *
 * DATABASE_URI is only used to reach the server (the database in it is not written to), so
 * its user must be allowed to create databases. The databases are new on every run for the
 * same reason the SQLite run uses a temporary file: tests that create unique values (coupon
 * codes, slugs) pass on every run, and Payload creates its tables in an empty database
 * without asking how to migrate tables left by an older version of the schema.
 *
 * Postgres is the adapter that always runs Payload's operations in a transaction, and a
 * transaction's writes are invisible to other connections until it commits. A statement the
 * plugin sends outside the request's transaction therefore fails or waits on a lock here,
 * where on SQLite (no transactions by default) it would go unnoticed.
 */
export default async function setup() {
  const serverUri = process.env.DATABASE_URI
  if (!serverUri) {
    throw new Error(
      'DATABASE_ADAPTER=postgres needs DATABASE_URI set to a Postgres connection string, for example postgres://postgres:postgres@127.0.0.1:5432/postgres',
    )
  }

  // Unique per run, so two runs against the same server do not share or drop each other's data.
  const mainDatabase = `payload_ecommerce_test_${Date.now()}_${process.pid}`
  // The name dev/payload.renamed.config.ts derives from DATABASE_URI.
  const databases = [mainDatabase, `${mainDatabase}_renamed`]

  const server = drizzle(serverUri)
  // CREATE and DROP DATABASE take no bound parameters; the names are built above from digits
  // and fixed text only.
  const run = (statement: string) => server.execute(sql.raw(statement))

  for (const database of databases) {
    await run(`CREATE DATABASE "${database}"`)
  }

  const testUri = new URL(serverUri)
  testUri.pathname = `/${mainDatabase}`
  process.env.DATABASE_URI = testUri.toString()

  return async () => {
    for (const database of databases) {
      // FORCE closes connections a test worker left open, which would otherwise block the drop.
      await run(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    }
    await server.$client.end()
  }
}
