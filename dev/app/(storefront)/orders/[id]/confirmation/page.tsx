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

export default async function OrderConfirmationPage({ params }: PageProps) {
  const { id } = await params;
  const payload = await getPayload({ config: configPromise });

  // Fetch order
  const order = await payload.findByID({
    collection: 'orders',
    id: id,
    depth: 2,
  });

  if (!order) {
    notFound();
  }

  // Fetch associated payment if paymentId exists
  let payment = null;
  if (order.paymentId) {
    try {
      payment = await payload.findByID({
        collection: 'payments',
        id: order.paymentId,
      });
    } catch (error) {
      console.error('Error fetching payment:', error);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Success Message */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          <svg
            className="w-8 h-8 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Order Confirmed!</h1>
        <p className="text-lg text-gray-600">
          Thank you for your purchase. Your order has been received.
        </p>
      </div>

      {/* Order Details */}
      <Card className="mb-8">
        <div className="border-b border-gray-200 pb-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-sm text-gray-600">Order Number</p>
              <p className="text-2xl font-bold text-gray-900">{order.orderNumber}</p>
            </div>
            <div>
              <OrderStatusBadge status={order.status as any} />
            </div>
          </div>
          <p className="text-sm text-gray-600 mt-2">
            Placed on {formatDateTime(order.createdAt)}
          </p>
        </div>

        {/* Order Items */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Order Items</h2>
          <div className="space-y-4">
            {order.items.map((item: any, index: number) => {
              const product = typeof item.product === 'object' ? item.product : null;
              if (!product) return null;

              return (
                <div key={index} className="flex gap-4">
                  <img
                    src={product.images?.[0]?.url || '/placeholder-product.jpg'}
                    alt={product.title}
                    className="w-20 h-20 object-cover rounded border border-gray-200"
                  />
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{product.title}</h3>
                    {item.variant && (
                      <p className="text-sm text-gray-600">Variant: {item.variant}</p>
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
        </div>

        {/* Order Summary */}
        <div className="border-t border-gray-200 pt-6">
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

      {/* Shipping and Billing */}
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

      {/* Payment Method */}
      <Card className="mb-8">
        <h3 className="font-bold text-gray-900 mb-3">Payment Information</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Payment Method:</span>
            <span className="text-gray-900 capitalize">
              {order.paymentMethod?.replace('_', ' ') || 'N/A'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Payment Status:</span>
            <span className={`font-medium capitalize ${
              order.paymentStatus === 'paid' ? 'text-green-600' :
              order.paymentStatus === 'failed' ? 'text-red-600' :
              'text-yellow-600'
            }`}>
              {order.paymentStatus || 'Pending'}
            </span>
          </div>
          {payment && (
            <>
              <div className="flex justify-between">
                <span className="text-gray-600">Payment Provider:</span>
                <span className="text-gray-900 uppercase">{payment.provider}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Provider Status:</span>
                <span className={`font-medium capitalize ${
                  payment.status === 'succeeded' ? 'text-green-600' :
                  payment.status === 'failed' ? 'text-red-600' :
                  'text-yellow-600'
                }`}>
                  {payment.status}
                </span>
              </div>
              {payment.providerId && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Transaction ID:</span>
                  <span className="text-gray-900 font-mono text-xs">{payment.providerId}</span>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Link href="/">
          <Button variant="primary" size="lg">
            Continue Shopping
          </Button>
        </Link>
        <Link href="/account/orders">
          <Button variant="outline" size="lg">
            View All Orders
          </Button>
        </Link>
      </div>
    </div>
  );
}
