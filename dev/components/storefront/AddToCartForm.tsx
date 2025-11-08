'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';

interface AddToCartFormProps {
  productId: number | string;
  isOutOfStock: boolean;
  maxQuantity?: number;
}

export function AddToCartForm({ productId, isOutOfStock, maxQuantity = 10 }: AddToCartFormProps) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);

  const handleAddToCart = async () => {
    if (isOutOfStock || isAdding) return;

    setIsAdding(true);
    try {
      const response = await fetch('/api/cart/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': 'demo-session',
        },
        body: JSON.stringify({
          productId: typeof productId === 'string' ? parseInt(productId, 10) : productId,
          quantity,
        }),
      });

      if (response.ok) {
        // Show success feedback and refresh
        router.refresh();
        // Optionally redirect to cart
        // router.push('/cart');
      } else {
        const error = await response.json();
        console.error('Failed to add to cart:', error);
        alert('Failed to add item to cart. Please try again.');
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
      alert('An error occurred. Please try again.');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <label htmlFor="quantity" className="text-sm font-medium text-gray-700">
          Quantity:
        </label>
        <select
          id="quantity"
          value={quantity}
          onChange={(e) => setQuantity(parseInt(e.target.value, 10))}
          disabled={isOutOfStock || isAdding}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        >
          {Array.from({ length: Math.min(maxQuantity, 10) }, (_, i) => i + 1).map((qty) => (
            <option key={qty} value={qty}>
              {qty}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-4">
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          disabled={isOutOfStock || isAdding}
          onClick={handleAddToCart}
        >
          {isAdding ? 'Adding...' : isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
        </Button>
      </div>
    </div>
  );
}
