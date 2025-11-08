import React from 'react';
import Link from 'next/link';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { OrderStatusBadge } from '../../../../components/storefront/OrderStatusBadge';
import { formatPrice, formatDate } from '../../../../lib/formatters';
import type { Order } from '@/payload-types';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const payload = await getPayload({ config: configPromise });

  // Fetch all orders (in a real app, filter by user)
  const { docs: orders } = await payload.find({
    collection: 'orders',
    sort: '-createdAt',
    limit: 50,
    depth: 1,
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Order History</h1>
        <p className="text-gray-600">View and track your orders</p>
      </div>

      {orders.length === 0 ? (
        <Card className="text-center py-16">
          <div className="mb-6">
            <svg
              className="mx-auto h-24 w-24 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">No orders yet</h2>
          <p className="text-gray-600 mb-8">Start shopping to place your first order</p>
          <Link href="/products">
            <Button variant="primary" size="lg">
              Browse Products
            </Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map((order: Order) => (
            <Card key={order.id} padding="none">
              <div className="p-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-gray-900">
                        Order {order.orderNumber}
                      </h3>
                      <OrderStatusBadge status={order.status as any} />
                    </div>
                    <p className="text-sm text-gray-600">
                      Placed on {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <div className="mt-4 md:mt-0 text-right">
                    <p className="text-sm text-gray-600">Total</p>
                    <p className="text-xl font-bold text-gray-900">
                      {formatPrice(order.total)}
                    </p>
                  </div>
                </div>

                {/* Order Items Preview */}
                <div className="border-t border-gray-200 pt-4 mb-4">
                  <div className="flex gap-4 overflow-x-auto pb-2">
                    {order.items.slice(0, 4).map((item: any, index: number) => {
                      const product = typeof item.product === 'object' ? item.product : null;
                      if (!product) return null;

                      return (
                        <div key={index} className="flex-shrink-0">
                          <img
                            src={product.images?.[0]?.url || '/placeholder-product.jpg'}
                            alt={product.title}
                            className="w-20 h-20 object-cover rounded border border-gray-200"
                          />
                        </div>
                      );
                    })}
                    {order.items.length > 4 && (
                      <div className="flex-shrink-0 w-20 h-20 bg-gray-100 rounded border border-gray-200 flex items-center justify-center">
                        <span className="text-sm font-medium text-gray-600">
                          +{order.items.length - 4}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-2">
                    {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <Link href={`/account/orders/${order.id}`} className="flex-1">
                    <Button variant="primary" className="w-full">
                      View Details
                    </Button>
                  </Link>
                  {order.trackingNumber && (
                    <Button variant="outline">Track Order</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
