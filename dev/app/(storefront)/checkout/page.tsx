'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Card } from '../../../components/ui/Card';
import { LoadingSpinner } from '../../../components/storefront/LoadingSpinner';
import { formatPrice } from '../../../lib/formatters';

interface FormData {
  shippingFirstName: string;
  shippingLastName: string;
  shippingAddress1: string;
  shippingAddress2: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingCountry: string;
  shippingPhone: string;
  billingFirstName: string;
  billingLastName: string;
  billingAddress1: string;
  billingAddress2: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  billingCountry: string;
  sameAsShipping: boolean;
  paymentMethod: string;
}

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<FormData>({
    shippingFirstName: '',
    shippingLastName: '',
    shippingAddress1: '',
    shippingAddress2: '',
    shippingCity: '',
    shippingState: '',
    shippingZip: '',
    shippingCountry: 'US',
    shippingPhone: '',
    billingFirstName: '',
    billingLastName: '',
    billingAddress1: '',
    billingAddress2: '',
    billingCity: '',
    billingState: '',
    billingZip: '',
    billingCountry: 'US',
    sameAsShipping: true,
    paymentMethod: 'credit_card',
  });

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

      if (!data.items || data.items.length === 0) {
        router.push('/cart');
        return;
      }

      setCart(data);
    } catch (error) {
      console.error('Error fetching cart:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof FormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Shipping validation
    if (!formData.shippingFirstName) newErrors.shippingFirstName = 'First name is required';
    if (!formData.shippingLastName) newErrors.shippingLastName = 'Last name is required';
    if (!formData.shippingAddress1) newErrors.shippingAddress1 = 'Address is required';
    if (!formData.shippingCity) newErrors.shippingCity = 'City is required';
    if (!formData.shippingState) newErrors.shippingState = 'State is required';
    if (!formData.shippingZip) newErrors.shippingZip = 'ZIP code is required';
    if (!formData.shippingPhone) newErrors.shippingPhone = 'Phone is required';

    // Billing validation (if different from shipping)
    if (!formData.sameAsShipping) {
      if (!formData.billingFirstName) newErrors.billingFirstName = 'First name is required';
      if (!formData.billingLastName) newErrors.billingLastName = 'Last name is required';
      if (!formData.billingAddress1) newErrors.billingAddress1 = 'Address is required';
      if (!formData.billingCity) newErrors.billingCity = 'City is required';
      if (!formData.billingState) newErrors.billingState = 'State is required';
      if (!formData.billingZip) newErrors.billingZip = 'ZIP code is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSubmitting(true);

    try {
      // Build shipping address
      const shippingAddress = {
        firstName: formData.shippingFirstName,
        lastName: formData.shippingLastName,
        address1: formData.shippingAddress1,
        address2: formData.shippingAddress2,
        city: formData.shippingCity,
        state: formData.shippingState,
        postalCode: formData.shippingZip,
        country: formData.shippingCountry,
        phone: formData.shippingPhone,
      };

      // Build billing address
      const billingAddress = formData.sameAsShipping
        ? { ...shippingAddress }
        : {
            firstName: formData.billingFirstName,
            lastName: formData.billingLastName,
            address1: formData.billingAddress1,
            address2: formData.billingAddress2,
            city: formData.billingCity,
            state: formData.billingState,
            postalCode: formData.billingZip,
            country: formData.billingCountry,
          };

      // Create order
      const response = await fetch('/api/checkout/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': 'demo-session',
        },
        body: JSON.stringify({
          shippingAddress,
          billingAddress,
          paymentMethod: formData.paymentMethod,
        }),
      });

      const result = await response.json();

      if (result.success && result.redirectUrl) {
        // Redirect to payment page (test provider) or confirmation
        window.location.href = result.redirectUrl;
      } else if (result.success) {
        // Fallback redirect to confirmation
        router.push(`/orders/${result.orderId}/confirmation`);
      } else {
        alert(result.error || 'Failed to create order');
      }
    } catch (error) {
      console.error('Error creating order:', error);
      alert('Failed to create order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <LoadingSpinner size="lg" text="Loading checkout..." />
      </div>
    );
  }

  if (!cart) {
    return null;
  }

  const subtotal = cart.subtotal || 0;
  const tax = Math.round(subtotal * 0.1 * 100) / 100;
  const shipping = subtotal >= 100 ? 0 : 10;
  const total = subtotal + tax + shipping;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Checkout</h1>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Checkout Form */}
          <div className="lg:col-span-2 space-y-8">
            {/* Shipping Information */}
            <Card>
              <h2 className="text-xl font-bold text-gray-900 mb-6">Shipping Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="First Name"
                  value={formData.shippingFirstName}
                  onChange={(e) => handleChange('shippingFirstName', e.target.value)}
                  error={errors.shippingFirstName}
                  required
                />
                <Input
                  label="Last Name"
                  value={formData.shippingLastName}
                  onChange={(e) => handleChange('shippingLastName', e.target.value)}
                  error={errors.shippingLastName}
                  required
                />
                <div className="md:col-span-2">
                  <Input
                    label="Address Line 1"
                    value={formData.shippingAddress1}
                    onChange={(e) => handleChange('shippingAddress1', e.target.value)}
                    error={errors.shippingAddress1}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    label="Address Line 2 (Optional)"
                    value={formData.shippingAddress2}
                    onChange={(e) => handleChange('shippingAddress2', e.target.value)}
                  />
                </div>
                <Input
                  label="City"
                  value={formData.shippingCity}
                  onChange={(e) => handleChange('shippingCity', e.target.value)}
                  error={errors.shippingCity}
                  required
                />
                <Input
                  label="State"
                  value={formData.shippingState}
                  onChange={(e) => handleChange('shippingState', e.target.value)}
                  error={errors.shippingState}
                  required
                />
                <Input
                  label="ZIP Code"
                  value={formData.shippingZip}
                  onChange={(e) => handleChange('shippingZip', e.target.value)}
                  error={errors.shippingZip}
                  required
                />
                <Input
                  label="Phone"
                  type="tel"
                  value={formData.shippingPhone}
                  onChange={(e) => handleChange('shippingPhone', e.target.value)}
                  error={errors.shippingPhone}
                  required
                />
              </div>
            </Card>

            {/* Billing Information */}
            <Card>
              <h2 className="text-xl font-bold text-gray-900 mb-6">Billing Information</h2>
              <div className="mb-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.sameAsShipping}
                    onChange={(e) => handleChange('sameAsShipping', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-gray-700">Same as shipping address</span>
                </label>
              </div>

              {!formData.sameAsShipping && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="First Name"
                    value={formData.billingFirstName}
                    onChange={(e) => handleChange('billingFirstName', e.target.value)}
                    error={errors.billingFirstName}
                    required
                  />
                  <Input
                    label="Last Name"
                    value={formData.billingLastName}
                    onChange={(e) => handleChange('billingLastName', e.target.value)}
                    error={errors.billingLastName}
                    required
                  />
                  <div className="md:col-span-2">
                    <Input
                      label="Address Line 1"
                      value={formData.billingAddress1}
                      onChange={(e) => handleChange('billingAddress1', e.target.value)}
                      error={errors.billingAddress1}
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Input
                      label="Address Line 2 (Optional)"
                      value={formData.billingAddress2}
                      onChange={(e) => handleChange('billingAddress2', e.target.value)}
                    />
                  </div>
                  <Input
                    label="City"
                    value={formData.billingCity}
                    onChange={(e) => handleChange('billingCity', e.target.value)}
                    error={errors.billingCity}
                    required
                  />
                  <Input
                    label="State"
                    value={formData.billingState}
                    onChange={(e) => handleChange('billingState', e.target.value)}
                    error={errors.billingState}
                    required
                  />
                  <Input
                    label="ZIP Code"
                    value={formData.billingZip}
                    onChange={(e) => handleChange('billingZip', e.target.value)}
                    error={errors.billingZip}
                    required
                  />
                </div>
              )}
            </Card>

            {/* Payment Information */}
            <Card>
              <h2 className="text-xl font-bold text-gray-900 mb-6">Payment Information</h2>
              <p className="text-gray-600 mb-4">
                <strong>Note:</strong> This is a demo store. No actual payment will be processed.
              </p>
              <div className="space-y-3">
                <label className="flex items-center p-4 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="credit_card"
                    checked={formData.paymentMethod === 'credit_card'}
                    onChange={(e) => handleChange('paymentMethod', e.target.value)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-3 font-medium text-gray-900">Credit Card</span>
                </label>
                <label className="flex items-center p-4 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="paypal"
                    checked={formData.paymentMethod === 'paypal'}
                    onChange={(e) => handleChange('paymentMethod', e.target.value)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="ml-3 font-medium text-gray-900">PayPal</span>
                </label>
              </div>
            </Card>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <Card className="sticky top-20">
              <h2 className="text-xl font-bold text-gray-900 mb-6">Order Summary</h2>

              {/* Cart Items */}
              <div className="space-y-4 mb-6 pb-6 border-b border-gray-200">
                {cart.items.map((item: any, index: number) => (
                  <div key={index} className="flex gap-3">
                    <img
                      src={item.product.images?.[0]?.url || '/placeholder-product.jpg'}
                      alt={item.product.title}
                      className="w-16 h-16 object-cover rounded border border-gray-200"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {item.product.title}
                      </p>
                      <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatPrice(item.product.price * item.quantity)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Tax</span>
                  <span>{formatPrice(tax)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Shipping</span>
                  <span>{shipping === 0 ? 'FREE' : formatPrice(shipping)}</span>
                </div>
                <div className="pt-3 border-t border-gray-200">
                  <div className="flex justify-between text-lg font-bold text-gray-900">
                    <span>Total</span>
                    <span>{formatPrice(total)}</span>
                  </div>
                </div>
              </div>

              {/* Place Order Button */}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                isLoading={submitting}
              >
                Place Order
              </Button>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
