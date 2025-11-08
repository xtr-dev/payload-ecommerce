'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Card } from '../../../components/ui/Card';
import { LoadingSpinner } from '../../../components/storefront/LoadingSpinner';
import { formatPrice } from '../../../lib/formatters';

interface CartItem {
  product: {
    id: string;
    title: string;
    slug: string;
    price: number;
    images?: any[];
  };
  variant?: string;
  quantity: number;
}

interface Cart {
  items: CartItem[];
  subtotal: number;
}

export default function CartPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [couponError, setCouponError] = useState('');
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);

  useEffect(() => {
    fetchCart();
  }, []);

  const fetchCart = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/cart/me', {
        headers: {
          'x-session-id': 'demo-session',
        },
      });
      const data = await response.json();
      setCart(data);
    } catch (error) {
      console.error('Error fetching cart:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateQuantity = async (productId: string, quantity: number, variant?: string) => {
    try {
      const response = await fetch('/api/cart/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': 'demo-session',
        },
        body: JSON.stringify({ productId, quantity, variant }),
      });
      const data = await response.json();
      setCart(data);
    } catch (error) {
      console.error('Error updating cart:', error);
    }
  };

  const removeItem = async (productId: string, variant?: string) => {
    try {
      const response = await fetch('/api/cart/remove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': 'demo-session',
        },
        body: JSON.stringify({ productId, variant }),
      });
      const data = await response.json();
      setCart(data);
    } catch (error) {
      console.error('Error removing item:', error);
    }
  };

  const validateCoupon = async () => {
    if (!couponCode.trim()) {
      setCouponError('Please enter a coupon code');
      return;
    }

    setIsValidatingCoupon(true);
    setCouponError('');

    try {
      const productIds = cart?.items.map(item => item.product.id) || [];
      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: couponCode,
          cartTotal: cart?.subtotal || 0,
          productIds,
        }),
      });

      const result = await response.json();

      if (result.valid) {
        setAppliedCoupon(result);
        setCouponError('');
      } else {
        setCouponError(result.message || 'Invalid coupon code');
        setAppliedCoupon(null);
      }
    } catch (error) {
      console.error('Error validating coupon:', error);
      setCouponError('Failed to validate coupon');
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponCode('');
    setCouponError('');
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <LoadingSpinner size="lg" text="Loading cart..." />
      </div>
    );
  }

  if (!cart || !cart.items || cart.items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
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
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Your cart is empty</h2>
          <p className="text-gray-600 mb-8">Start shopping to add items to your cart</p>
          <Link href="/products">
            <Button variant="primary" size="lg">
              Browse Products
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const subtotal = cart.subtotal || 0;
  const discount = appliedCoupon?.discount || 0;
  const tax = Math.round((subtotal - discount) * 0.1 * 100) / 100;
  const shipping = subtotal >= 100 ? 0 : 10;
  const total = subtotal - discount + tax + shipping;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Shopping Cart</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cart Items */}
        <div className="lg:col-span-2">
          <Card>
            <div className="divide-y divide-gray-200">
              {cart.items.map((item, index) => {
                const imageUrl = item.product.images?.[0]?.url || '/placeholder-product.jpg';

                return (
                  <div key={index} className="py-6 flex gap-6">
                    {/* Product Image */}
                    <Link href={`/products/${item.product.slug}`} className="flex-shrink-0">
                      <img
                        src={imageUrl}
                        alt={item.product.title}
                        className="w-24 h-24 object-cover rounded-md border border-gray-200"
                      />
                    </Link>

                    {/* Product Info */}
                    <div className="flex-1 min-w-0">
                      <Link href={`/products/${item.product.slug}`}>
                        <h3 className="text-lg font-semibold text-gray-900 hover:text-blue-600 mb-1">
                          {item.product.title}
                        </h3>
                      </Link>
                      {item.variant && (
                        <p className="text-sm text-gray-600 mb-2">Variant: {item.variant}</p>
                      )}
                      <p className="text-lg font-semibold text-gray-900">
                        {formatPrice(item.product.price)}
                      </p>
                    </div>

                    {/* Quantity and Remove */}
                    <div className="flex flex-col items-end justify-between">
                      <button
                        onClick={() => removeItem(item.product.id, item.variant)}
                        className="text-red-600 hover:text-red-700 text-sm font-medium"
                      >
                        Remove
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            updateQuantity(item.product.id, Math.max(1, item.quantity - 1), item.variant)
                          }
                          className="w-8 h-8 rounded-md border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                        >
                          −
                        </button>
                        <span className="w-12 text-center font-medium">{item.quantity}</span>
                        <button
                          onClick={() =>
                            updateQuantity(item.product.id, item.quantity + 1, item.variant)
                          }
                          className="w-8 h-8 rounded-md border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                        >
                          +
                        </button>
                      </div>

                      <p className="text-lg font-bold text-gray-900">
                        {formatPrice(item.product.price * item.quantity)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Order Summary */}
        <div className="lg:col-span-1">
          <Card className="sticky top-20">
            <h2 className="text-xl font-bold text-gray-900 mb-6">Order Summary</h2>

            {/* Coupon Code */}
            <div className="mb-6 pb-6 border-b border-gray-200">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Coupon Code
              </label>
              <div className="flex gap-2">
                <Input
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="Enter code"
                  disabled={!!appliedCoupon}
                />
                {appliedCoupon ? (
                  <Button variant="outline" onClick={removeCoupon}>
                    Remove
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={validateCoupon}
                    isLoading={isValidatingCoupon}
                  >
                    Apply
                  </Button>
                )}
              </div>
              {couponError && <p className="mt-2 text-sm text-red-600">{couponError}</p>}
              {appliedCoupon && (
                <p className="mt-2 text-sm text-green-600">
                  ✓ Coupon applied: {appliedCoupon.message}
                </p>
              )}
            </div>

            {/* Totals */}
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Discount</span>
                  <span>-{formatPrice(discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-600">
                <span>Tax (10%)</span>
                <span>{formatPrice(tax)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Shipping</span>
                <span>{shipping === 0 ? 'FREE' : formatPrice(shipping)}</span>
              </div>
              {subtotal < 100 && shipping > 0 && (
                <p className="text-xs text-gray-500">
                  Add {formatPrice(100 - subtotal)} more for free shipping!
                </p>
              )}
              <div className="pt-3 border-t border-gray-200">
                <div className="flex justify-between text-lg font-bold text-gray-900">
                  <span>Total</span>
                  <span>{formatPrice(total)}</span>
                </div>
              </div>
            </div>

            {/* Checkout Button */}
            <Link href="/checkout">
              <Button variant="primary" size="lg" className="w-full mb-4">
                Proceed to Checkout
              </Button>
            </Link>

            <Link href="/products">
              <Button variant="outline" className="w-full">
                Continue Shopping
              </Button>
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
