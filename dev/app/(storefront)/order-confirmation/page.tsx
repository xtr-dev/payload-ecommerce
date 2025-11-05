'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

interface Order {
  id: string
  orderNumber: string
  total: number
  status: string
  customerEmail: string
  items: Array<{
    product: {
      title: string
    }
    quantity: number
    price: number
  }>
  shippingAddress: {
    name: string
    street: string
    city: string
    state: string
    postalCode: string
    country: string
  }
}

export default function OrderConfirmationPage() {
  const searchParams = useSearchParams()
  const orderId = searchParams?.get('id')
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (orderId) {
      fetchOrder()
    }
  }, [orderId])

  const fetchOrder = async () => {
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        setOrder(data)
      }
    } catch (error) {
      console.error('Error fetching order:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">Loading order details...</div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <h1 className="text-2xl font-bold mb-4">Order Not Found</h1>
        <Link href="/" className="text-primary-600 hover:text-primary-700">
          Return to Home
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Success Message */}
      <div className="text-center mb-12">
        <div className="bg-green-100 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-12 h-12 text-green-600"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-4xl font-bold mb-4">Order Confirmed!</h1>
        <p className="text-gray-600 text-lg mb-2">
          Thank you for your order. We've sent a confirmation email to{' '}
          <span className="font-medium">{order.customerEmail}</span>
        </p>
        <p className="text-gray-600">
          Order Number: <span className="font-mono font-semibold">{order.orderNumber}</span>
        </p>
      </div>

      {/* Order Details */}
      <div className="space-y-6">
        {/* Items */}
        <div className="card">
          <h2 className="text-2xl font-bold mb-4">Order Items</h2>
          <div className="space-y-3">
            {order.items.map((item, index) => (
              <div key={index} className="flex justify-between border-b pb-3 last:border-b-0">
                <div>
                  <p className="font-medium">{item.product.title}</p>
                  <p className="text-sm text-gray-600">Quantity: {item.quantity}</p>
                </div>
                <p className="font-semibold">${(item.price * item.quantity).toFixed(2)}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 pt-6 border-t">
            <div className="flex justify-between text-xl font-bold">
              <span>Total:</span>
              <span className="text-primary-600">${order.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Shipping Address */}
        <div className="card">
          <h2 className="text-2xl font-bold mb-4">Shipping Address</h2>
          <div className="text-gray-700">
            <p className="font-medium">{order.shippingAddress.name}</p>
            <p>{order.shippingAddress.street}</p>
            <p>
              {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
              {order.shippingAddress.postalCode}
            </p>
            <p>{order.shippingAddress.country}</p>
          </div>
        </div>

        {/* Order Status */}
        <div className="card">
          <h2 className="text-2xl font-bold mb-4">Order Status</h2>
          <div className="flex items-center">
            <span
              className={`px-4 py-2 rounded-full font-semibold ${
                order.status === 'pending'
                  ? 'bg-yellow-100 text-yellow-800'
                  : order.status === 'processing'
                    ? 'bg-blue-100 text-blue-800'
                    : order.status === 'shipped'
                      ? 'bg-purple-100 text-purple-800'
                      : order.status === 'delivered'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
              }`}
            >
              {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
        <Link href="/products" className="btn-primary text-center">
          Continue Shopping
        </Link>
        <Link href="/" className="btn-secondary text-center">
          Return to Home
        </Link>
      </div>
    </div>
  )
}
