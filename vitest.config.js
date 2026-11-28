import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { loadEnv } from 'payload/node'
import { fileURLToPath } from 'url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default defineConfig(() => {
  loadEnv(path.resolve(dirname, './dev'))

  // DATABASE_ADAPTER=mongodb (`pnpm test:mongo`) runs the same tests against an in-memory
  // MongoDB replica set, and DATABASE_ADAPTER=postgres (`pnpm test:postgres`) against new
  // databases on a running Postgres server. Each has a global setup file that prepares the
  // database and sets DATABASE_URI for the test workers.
  const adapterName = process.env.DATABASE_ADAPTER || 'sqlite'
  const globalSetupFiles = {
    mongodb: ['./dev/helpers/mongoGlobalSetup.ts'],
    postgres: ['./dev/helpers/postgresGlobalSetup.ts'],
    sqlite: [],
  }
  if (!(adapterName in globalSetupFiles)) {
    throw new Error(`DATABASE_ADAPTER must be sqlite, mongodb or postgres, but is "${adapterName}"`)
  }

  // Each SQLite run gets an empty database in a temporary directory instead of the
  // developer's dev/payload.db, so tests that create unique values (coupon codes, slugs)
  // pass on every run and never touch demo data.
  const databaseDirectory =
    adapterName === 'sqlite' ? mkdtempSync(path.join(os.tmpdir(), 'payload-ecommerce-test-')) : undefined
  if (databaseDirectory) {
    process.on('exit', () => rmSync(databaseDirectory, { force: true, recursive: true }))
  }

  return {
    plugins: [
      tsconfigPaths({
        ignoreConfigErrors: true,
      }),
    ],
    test: {
      env: {
        ...(databaseDirectory ? { DATABASE_URI: `file:${path.join(databaseDirectory, 'payload.db')}` } : {}),
        // The dev seed draws a picture for every product; storing twenty uploads would slow
        // every run down and no test looks at them.
        SEED_SKIP_IMAGES: 'true',
      },
      // `pnpm test:coverage` reports on the plugin itself, not on the demo around it.
      coverage: { include: ['src/**'], reporter: ['text'] },
      environment: 'node',
      globalSetup: globalSetupFiles[adapterName],
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }
})
