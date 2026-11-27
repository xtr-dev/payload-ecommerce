import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { payloadEcommerce } from 'payload-ecommerce'
import { fileURLToPath } from 'url'

/**
 * A second Payload config, used only by dev/renamed.spec.ts: every plugin collection has
 * another slug than its default (some renamed by a string, some by a CollectionExtender),
 * and the users and media collections have other slugs too. Nothing in this config is
 * called `products`, `orders`, `carts`, `coupons`, `categories`, `users` or `media`, so
 * any place in the plugin that still assumes a default slug fails here.
 *
 * It uses its own database next to the one of dev/payload.config.ts, derived from the same
 * DATABASE_URI, so both test files can run at the same time.
 */
const dirname = path.dirname(fileURLToPath(import.meta.url))

const useMongoDB = process.env.DATABASE_ADAPTER === 'mongodb'
const baseUri = process.env.DATABASE_URI || `file:${path.resolve(dirname, 'payload.db')}`

const databaseAdapter = useMongoDB
  ? mongooseAdapter({
      ensureIndexes: true,
      // Same server, other database name (the path segment before the query string).
      url: baseUri.replace(/\/([^/?]+)(\?|$)/, '/$1-renamed$2'),
    })
  : sqliteAdapter({ client: { url: baseUri.replace(/\.db$/, '-renamed.db') } })

export default buildConfig({
  admin: { user: 'customers' },
  collections: [
    {
      slug: 'customers',
      auth: true,
      fields: [{ name: 'role', type: 'select', defaultValue: 'customer', options: ['admin', 'customer'] }],
    },
    { slug: 'uploads', fields: [], upload: { staticDir: path.resolve(dirname, 'media') } },
  ],
  db: databaseAdapter,
  editor: lexicalEditor(),
  plugins: [
    payloadEcommerce({
      cartCleanupTask: true,
      collections: {
        carts: 'baskets',
        categories: 'shop-categories',
        // Renamed from inside an extender, which the plugin only learns by calling it.
        coupons: (base) => ({ ...base, slug: 'vouchers' }),
        orders: (base) => ({
          ...base,
          slug: 'shopOrders',
          fields: [...base.fields, { name: 'reference', type: 'text' }],
        }),
        products: 'shop-products',
      },
      mediaCollection: 'uploads',
      userCollection: 'customers',
    }),
  ],
  secret: 'test-secret_key',
  typescript: { autoGenerate: false },
})
