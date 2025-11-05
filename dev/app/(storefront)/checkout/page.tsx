'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Cart {
  id: string
  items: Array<{
    product: {
      id: string
      title: string
      price: number
    }
    quantity: number
    variant?: string
  }>
  subtotal: number
}

export default function CheckoutPage() {
  const router = useRouter()
  const [cart, setCart] = useState<Cart | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [couponCode, setCouponCode] = useState('')
  const [discount, setDiscount] = useState(0)

  const [formData, setFormData] = useState({
    email: '',
    shippingAddress: {
      name: '',
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'United States',
    },
    billingAddress: {
      name: '',
      street: '',
      city: '',
      state: '',
      postalCode: '',
      country: 'United States',
    },
    sameAsShipping: true,
  })

  useEffect(() => {
    fetchCart()
  }, [])

  const fetchCart = async () => {
    try {
      const response = await fetch('/api/carts/me', {
        credentials: 'include',
      })
      if (response.ok) {
        const data = await response.json()
        if (!data || !data.items || data.items.length === 0) {
          router.push('/cart')
          return
        }
        setCart(data)
      } else {
        router.push('/cart')
      }
    } catch (error) {
      console.error('Error fetching cart:', error)
      router.push('/cart')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const orderData = {
        items: cart!.items.map((item) => ({
          product: item.product.id,
          quantity: item.quantity,
          price: item.product.price,
          variant: item.variant,
        })),
        subtotal: cart!.subtotal,
        tax: cart!.subtotal * 0.1, // 10% tax
        shipping: 10, // Fixed shipping
        discount,
        total: cart!.subtotal + cart!.subtotal * 0.1 + 10 - discount,
        shippingAddress: formData.shippingAddress,
        billingAddress: formData.sameAsShipping
          ? formData.shippingAddress
          : formData.billingAddress,
        customerEmail: formData.email,
        status: 'pending',
        paymentStatus: 'pending',
      }

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(orderData),
      })

      if (response.ok) {
        const order = await response.json()
        // Clear cart
        await fetch('/api/cart/clear', {
          method: 'POST',
          credentials: 'include',
        })
        router.push(`/order-confirmation?id=${order.doc.id}`)
      } else {
        setError('Failed to create order. Please try again.')
      }
    } catch (error) {
      setError('An error occurred. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const applyCoupon = async () => {
    try {
      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: couponCode,
          subtotal: cart!.subtotal,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setDiscount(data.discount)
      } else {
        setError('Invalid coupon code')
      }
    } catch (error) {
      setError('Error applying coupon')
    }
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">Loading checkout...</div>
      </div>
    )
  }

  if (!cart) {
    return null
  }

  const tax = cart.subtotal * 0.1
  const shipping = 10
  const total = cart.subtotal + tax + shipping - discount

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-bold mb-8">Checkout</h1>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Checkout Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Contact Information */}
            <div className="card">
              <h2 className="text-2xl font-bold mb-4">Contact Information</h2>
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            {/* Shipping Address */}
            <div className="card">
              <h2 className="text-2xl font-bold mb-4">Shipping Address</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Full Name</label>
                  <input
                    type="text"
                    required
                    value={formData.shippingAddress.name}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        shippingAddress: { ...formData.shippingAddress, name: e.target.value },
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Street Address</label>
                  <input
                    type="text"
                    required
                    value={formData.shippingAddress.street}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        shippingAddress: { ...formData.shippingAddress, street: e.target.value },
                      })
                    }
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">City</label>
                    <input
                      type="text"
                      required
                      value={formData.shippingAddress.city}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          shippingAddress: { ...formData.shippingAddress, city: e.target.value },
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">State</label>
                    <input
                      type="text"
                      required
                      value={formData.shippingAddress.state}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          shippingAddress: { ...formData.shippingAddress, state: e.target.value },
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Postal Code</label>
                    <input
                      type="text"
                      required
                      value={formData.shippingAddress.postalCode}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          shippingAddress: {
                            ...formData.shippingAddress,
                            postalCode: e.target.value,
                          },
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Country</label>
                    <input
                      type="text"
                      required
                      value={formData.shippingAddress.country}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          shippingAddress: { ...formData.shippingAddress, country: e.target.value },
                        })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Billing Address */}
            <div className="card">
              <div className="flex items-center mb-4">
                <input
                  type="checkbox"
                  id="sameAsShipping"
                  checked={formData.sameAsShipping}
                  onChange={(e) =>
                    setFormData({ ...formData, sameAsShipping: e.target.checked })
                  }
                  className="mr-2"
                />
                <label htmlFor="sameAsShipping" className="font-medium">
                  Billing address same as shipping
                </label>
              </div>
              {!formData.sameAsShipping && (
                <div className="space-y-4">
                  {/* Similar fields as shipping address */}
                  <p className="text-sm text-gray-600">
                    Fill in your billing address details...
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <div className="card sticky top-24">
              <h2 className="text-2xl font-bold mb-6">Order Summary</h2>
              <div className="space-y-3 mb-6">
                {cart.items.map((item) => (
                  <div key={item.product.id} className="flex justify-between text-sm">
                    <span>
                      {item.product.title} x{item.quantity}
                    </span>
                    <span>${(item.product.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t pt-4 space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal:</span>
                  <span className="font-semibold">${cart.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Shipping:</span>
                  <span className="font-semibold">${shipping.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Tax:</span>
                  <span className="font-semibold">${tax.toFixed(2)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount:</span>
                    <span className="font-semibold">-${discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="border-t pt-3 flex justify-between text-lg">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold text-primary-600">${total.toFixed(2)}</span>
                </div>
              </div>

              {/* Coupon Code */}
              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">Coupon Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value)}
                    placeholder="Enter code"
                    className="flex-grow px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <button
                    type="button"
                    onClick={applyCoupon}
                    className="btn-secondary"
                  >
                    Apply
                  </button>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Processing...' : 'Place Order'}
              </button>
              <Link href="/cart" className="btn-secondary w-full mt-3 block text-center">
                Back to Cart
              </Link>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
