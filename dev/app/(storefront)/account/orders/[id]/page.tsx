import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { OrderStatusBadge } from '@/components/storefront/OrderStatusBadge';
import { formatPrice, formatDateTime } from '@/lib/formatters';
import type { Order } from '@/payload-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { id } = await params;
  const payload = await getPayload({ config: configPromise });

  // Fetch order
  let order: Order;
  try {
    order = await payload.findByID({
      collection: 'orders',
      id: id,
      depth: 2,
    });
  } catch (error) {
    notFound();
  }

  if (!order) {
    notFound();
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm">
        <ol className="flex items-center space-x-2 text-gray-600">
          <li>
            <Link href="/" className="hover:text-blue-600">
              Home
            </Link>
          </li>
          <li>/</li>
          <li>
            <Link href="/account/orders" className="hover:text-blue-600">
              Orders
            </Link>
          </li>
          <li>/</li>
          <li className="text-gray-900 font-medium">{order.orderNumber}</li>
        </ol>
      </nav>

      {/* Order Header */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Order {order.orderNumber}
            </h1>
            <p className="text-gray-600">Placed on {formatDateTime(order.createdAt)}</p>
          </div>
          <div className="mt-4 md:mt-0">
            <OrderStatusBadge status={order.status as any} />
          </div>
        </div>
      </div>

      {/* Order Status Timeline */}
      <Card className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Order Status</h2>
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
          <div className="space-y-6">
            <div className="relative flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center z-10">
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1 pb-6">
                <p className="font-medium text-gray-900">Order Placed</p>
                <p className="text-sm text-gray-600">{formatDateTime(order.createdAt)}</p>
              </div>
            </div>

            {['processing', 'shipped', 'delivered'].includes(order.status) && (
              <div className="relative flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center z-10">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1 pb-6">
                  <p className="font-medium text-gray-900">Processing</p>
                  <p className="text-sm text-gray-600">Your order is being prepared</p>
                </div>
              </div>
            )}

            {['shipped', 'delivered'].includes(order.status) && (
              <div className="relative flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center z-10">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1 pb-6">
                  <p className="font-medium text-gray-900">Shipped</p>
                  <p className="text-sm text-gray-600">Your order is on its way</p>
                  {order.trackingNumber && (
                    <p className="text-sm text-blue-600 mt-1">
                      Tracking: {order.trackingNumber}
                    </p>
                  )}
                </div>
              </div>
            )}

            {order.status === 'delivered' && (
              <div className="relative flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center z-10">
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">Delivered</p>
                  <p className="text-sm text-gray-600">Your order has been delivered</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Order Items */}
      <Card className="mb-8">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Order Items</h2>
        <div className="space-y-4">
          {order.items.map((item: any, index: number) => {
            const product = typeof item.product === 'object' ? item.product : null;
            if (!product) return null;

            return (
              <div key={index} className="flex gap-4 pb-4 border-b border-gray-200 last:border-0 last:pb-0">
                <Link href={`/products/${product.slug}`}>
                  <img
                    src={product.images?.[0]?.url || '/placeholder-product.jpg'}
                    alt={product.title}
                    className="w-24 h-24 object-cover rounded border border-gray-200"
                  />
                </Link>
                <div className="flex-1">
                  <Link href={`/products/${product.slug}`}>
                    <h3 className="font-medium text-gray-900 hover:text-blue-600">
                      {product.title}
                    </h3>
                  </Link>
                  {item.variant && (
                    <p className="text-sm text-gray-600 mt-1">Variant: {item.variant}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-sm text-gray-600">Qty: {item.quantity}</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatPrice(item.price)}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">
                    {formatPrice(item.price * item.quantity)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Order Summary */}
        <div className="border-t border-gray-200 mt-6 pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{formatPrice(order.subtotal)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount</span>
                <span>-{formatPrice(order.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Tax</span>
              <span>{formatPrice(order.tax)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Shipping</span>
              <span>{order.shipping === 0 ? 'FREE' : formatPrice(order.shipping)}</span>
            </div>
            <div className="pt-2 border-t border-gray-200">
              <div className="flex justify-between text-lg font-bold text-gray-900">
                <span>Total</span>
                <span>{formatPrice(order.total)}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Addresses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <Card>
          <h3 className="font-bold text-gray-900 mb-3">Shipping Address</h3>
          <div className="text-sm text-gray-600 space-y-1">
            <p>
              {order.shippingAddress.firstName} {order.shippingAddress.lastName}
            </p>
            <p>{order.shippingAddress.address1}</p>
            {order.shippingAddress.address2 && <p>{order.shippingAddress.address2}</p>}
            <p>
              {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
              {order.shippingAddress.postalCode}
            </p>
            <p>{order.shippingAddress.country}</p>
            {order.shippingAddress.phone && <p>Phone: {order.shippingAddress.phone}</p>}
          </div>
        </Card>

        <Card>
          <h3 className="font-bold text-gray-900 mb-3">Billing Address</h3>
          <div className="text-sm text-gray-600 space-y-1">
            <p>
              {order.billingAddress.firstName} {order.billingAddress.lastName}
            </p>
            <p>{order.billingAddress.address1}</p>
            {order.billingAddress.address2 && <p>{order.billingAddress.address2}</p>}
            <p>
              {order.billingAddress.city}, {order.billingAddress.state}{' '}
              {order.billingAddress.postalCode}
            </p>
            <p>{order.billingAddress.country}</p>
          </div>
        </Card>
      </div>

      {/* Payment */}
      <Card className="mb-8">
        <h3 className="font-bold text-gray-900 mb-3">Payment Information</h3>
        <div className="text-sm text-gray-600">
          <p className="capitalize">
            Method: {order.paymentMethod?.replace('_', ' ') || 'N/A'}
          </p>
          <p className="capitalize">Status: {order.paymentStatus || 'Pending'}</p>
          {order.paymentId && (
            <p>Transaction ID: {order.paymentId}</p>
          )}
        </div>
      </Card>

      {/* Actions */}
      <div className="flex gap-4">
        <Link href="/account/orders" className="flex-1">
          <Button variant="outline" className="w-full">
            ← Back to Orders
          </Button>
        </Link>
        <Link href="/" className="flex-1">
          <Button variant="primary" className="w-full">
            Continue Shopping
          </Button>
        </Link>
      </div>
    </div>
  );
}
