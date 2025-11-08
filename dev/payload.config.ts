import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { payloadEcommerce } from 'payload-ecommerce'
import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { billingPlugin, testProvider } from '@xtr-dev/payload-billing'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    {
      slug: 'posts',
      fields: [],
    },
    {
      slug: 'media',
      fields: [],
      upload: {
        staticDir: path.resolve(dirname, 'media'),
      },
      access: {
        read: () => true, // Allow public read access to media files
      },
    },
  ],
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URI || `file:${path.resolve(dirname, 'payload.db')}`,
    },
  }),
  editor: lexicalEditor(),
  email: testEmailAdapter,
  onInit: async (payload) => {
    await seed(payload);
  },
  plugins: [
    payloadEcommerce({
      hooks: {
        // Example tax calculation hook - calculates 10% tax on taxable amount
        calculateTax: async (orderData) => {
          // You can implement complex logic here based on:
          // - Shipping address (state/country)
          // - Product tax categories
          // - Integration with tax services (Stripe Tax, Avalara, etc.)

          const taxableAmount = orderData.subtotal - orderData.discount;
          const taxRate = 0.10; // 10% tax rate

          return Math.round(taxableAmount * taxRate * 100) / 100;
        },
      },
    }),
    billingPlugin({
      providers: [
        testProvider({
          enabled: true,
          testModeIndicators: {
            showWarningBanners: true,
            showTestBadges: true,
            consoleWarnings: true,
          },
          customUiRoute: '/test-payment',
          baseUrl: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
        }),
      ],
      collections: {
        payments: {
          slug: 'payments',
          extend: (config: any) => ({
            ...config,
            hooks: {
              ...config.hooks,
              afterChange: [
                ...(config.hooks?.afterChange || []),
                // Hook to sync payment status to order
                async ({ doc, operation, req }: any) => {
                  // Sync payment status to order when payment status changes
                  if ((operation === 'update' || operation === 'create') && doc.metadata?.orderId) {
                    const orderId = doc.metadata.orderId;

                    // Map billing plugin status to order payment status
                    const paymentStatusMap: Record<string, string> = {
                      'succeeded': 'paid',
                      'paid': 'paid',
                      'failed': 'failed',
                      'canceled': 'failed',
                      'cancelled': 'failed',
                      'pending': 'pending',
                      'processing': 'pending',
                    };

                    // Map billing plugin status to order status
                    const orderStatusMap: Record<string, string> = {
                      'succeeded': 'processing',
                      'paid': 'processing',
                      'failed': 'cancelled',
                      'canceled': 'cancelled',
                      'cancelled': 'cancelled',
                      'pending': 'pending',
                      'processing': 'pending',
                    };

                    const paymentStatus = paymentStatusMap[doc.status] || 'pending';
                    const orderStatus = orderStatusMap[doc.status] || 'pending';

                    try {
                      await req.payload.update({
                        collection: 'orders',
                        id: orderId,
                        data: {
                          paymentStatus: paymentStatus as 'pending' | 'paid' | 'failed' | 'refunded',
                          status: orderStatus as 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded',
                        },
                      });
                    } catch (error) {
                      req.payload.logger.error(`[Billing Sync] Failed to update order ${orderId}:`, error);
                    }
                  }
                },
              ],
            },
          }),
        },
        invoices: {
          slug: 'invoices',
          // Use extend to add custom fields and hooks to the invoice collection
          extend: (config: any) => ({
            ...config,
            fields: [
              ...(config.fields || []),
              // Add a custom field to track the associated order
              {
                name: 'order',
                type: 'relationship',
                relationTo: 'orders',
                admin: {
                  description: 'Associated ecommerce order',
                },
              },
            ],
            hooks: {
              ...config.hooks,
              beforeChange: [
                ...(config.hooks?.beforeChange || []),
                // Hook to auto-populate invoice from order data if order is provided
                async ({ data, req, operation }: any) => {
                  if (operation === 'create' && data.order) {
                    try {
                      const order = await req.payload.findByID({
                        collection: 'orders',
                        id: typeof data.order === 'object' ? data.order.id : data.order,
                      })

                      // Auto-populate customer info from order if not provided
                      if (!data.customerInfo && order.billingAddress) {
                        data.customerInfo = {
                          name: `${order.billingAddress.firstName} ${order.billingAddress.lastName}`,
                          email: order.user?.email || '',
                          phone: order.billingAddress.phone || '',
                        }
                      }

                      // Auto-populate billing address from order if not provided
                      if (!data.billingAddress && order.billingAddress) {
                        data.billingAddress = {
                          line1: order.billingAddress.address1,
                          line2: order.billingAddress.address2,
                          city: order.billingAddress.city,
                          state: order.billingAddress.state,
                          postalCode: order.billingAddress.postalCode,
                          country: order.billingAddress.country,
                        }
                      }
                    } catch (error) {
                      req.payload.logger.error('Failed to populate invoice from order:', error)
                    }
                  }
                  return data
                },
              ],
            },
          }),
        },
        refunds: 'refunds',
      },
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
