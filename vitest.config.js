import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { loadEnv } from 'payload/node'
import { fileURLToPath } from 'url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults, defineConfig } from 'vitest/config'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default defineConfig(() => {
  loadEnv(path.resolve(dirname, './dev'))

  // DATABASE_ADAPTER=mongodb (`pnpm test:mongo`) runs the same tests against an in-memory
  // MongoDB replica set, started by the global setup file, which also sets DATABASE_URI.
  const useMongoDB = process.env.DATABASE_ADAPTER === 'mongodb'

  // Each SQLite run gets an empty database in a temporary directory instead of the
  // developer's dev/payload.db, so tests that create unique values (coupon codes, slugs)
  // pass on every run and never touch demo data.
  const databaseDirectory = useMongoDB
    ? undefined
    : mkdtempSync(path.join(os.tmpdir(), 'payload-ecommerce-test-'))
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
        // The dev seed downloads product images from picsum.photos; tests must not need the network.
        SEED_SKIP_IMAGES: 'true',
      },
      environment: 'node',
      globalSetup: useMongoDB ? ['./dev/helpers/mongoGlobalSetup.ts'] : [],
      // e2e.spec.ts is a Playwright suite (run by playwright.config.js); importing
      // @playwright/test inside vitest throws at collection time
      exclude: [...configDefaults.exclude, 'dev/e2e.spec.ts'],
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }
})
