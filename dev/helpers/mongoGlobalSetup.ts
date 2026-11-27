import { MongoMemoryReplSet } from 'mongodb-memory-server'

/**
 * Vitest global setup for `pnpm test:mongo`: starts an in-memory MongoDB and points
 * DATABASE_URI at it before the test workers start, then stops it after the run.
 *
 * It is a replica set (of one member) rather than a standalone server because MongoDB
 * only supports transactions on a replica set, and Payload's MongoDB adapter runs every
 * operation in a transaction when it can. That is the setup in which the plugin's
 * transaction handling (rollback of a failed order, statements joining the request's
 * session) is actually exercised.
 */
export default async function setup() {
  const replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, dbName: 'payload-ecommerce-test', storageEngine: 'wiredTiger' },
  })

  process.env.DATABASE_URI = replicaSet.getUri('payload-ecommerce-test')

  return async () => {
    await replicaSet.stop()
  }
}
