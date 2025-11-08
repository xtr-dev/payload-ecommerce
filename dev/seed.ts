import type { Payload } from 'payload'

import { devUser } from './helpers/credentials.js'
import { seedDatabase } from './seed-data/index.js'

export const seed = async (payload: Payload) => {
  const { totalDocs } = await payload.count({
    collection: 'users',
    where: {
      email: {
        equals: devUser.email,
      },
    },
  })

  if (!totalDocs) {
    await payload.create({
      collection: 'users',
      data: devUser,
    })
  }

  // Seed ecommerce data
  const { totalDocs: productCount } = await payload.count({
    collection: 'products',
  })

  if (productCount === 0) {
    await seedDatabase(payload)
  }
}
