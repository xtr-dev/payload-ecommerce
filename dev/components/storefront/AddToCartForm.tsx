'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button.js';

interface Variant {
  name: string;
  sku?: string;
  price?: number;
  inventory?: number;
}

interface AddToCartFormProps {
  productId: number | string;
  isOutOfStock: boolean;
  maxQuantity?: number;
  variants?: Variant[];
  trackQuantity?: boolean;
  basePrice?: number;
}

export function AddToCartForm({
  productId,
  isOutOfStock,
  maxQuantity = 10,
  variants = [],
  trackQuantity = false,
  basePrice = 0,
}: AddToCartFormProps) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState<number | null>(
    variants.length > 0 ? 0 : null
  );

  const selectedVariant = selectedVariantIndex !== null ? variants[selectedVariantIndex] : null;
  const variantQuantity = selectedVariant?.inventory ?? maxQuantity;
  const variantOutOfStock = trackQuantity && variantQuantity === 0;
  const effectiveIsOutOfStock = variants.length > 0 ? variantOutOfStock : isOutOfStock;
  const effectiveMaxQuantity = variants.length > 0 ? variantQuantity : maxQuantity;

  const handleAddToCart = async () => {
    if (effectiveIsOutOfStock || isAdding) return;

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
          variant: selectedVariant?.sku,
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
      {/* Variant Selection */}
      {variants.length > 0 && (
        <div>
          <label className="text-sm font-semibold text-gray-900 mb-3 block">
            Select Variant
          </label>
          <div className="grid grid-cols-2 gap-2">
            {variants.map((variant, index) => {
              const variantPrice = variant.price || basePrice;
              const variantQty = variant.inventory ?? maxQuantity;
              const variantIsOutOfStock = trackQuantity && variantQty === 0;
              const isSelected = selectedVariantIndex === index;

              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setSelectedVariantIndex(index)}
                  disabled={variantIsOutOfStock}
                  className={`border rounded-md p-3 text-left transition-colors ${
                    variantIsOutOfStock
                      ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                      : isSelected
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500'
                      : 'border-gray-300 hover:border-blue-300 cursor-pointer'
                  }`}
                >
                  <div className="font-medium text-sm text-gray-900">{variant.name}</div>
                  {variant.price && (
                    <div className="text-sm text-gray-600 mt-1">
                      ${variantPrice.toFixed(2)}
                    </div>
                  )}
                  {variantIsOutOfStock && (
                    <div className="text-xs text-red-600 mt-1">Out of Stock</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quantity Selection */}
      <div className="flex items-center gap-4">
        <label htmlFor="quantity" className="text-sm font-medium text-gray-700">
          Quantity:
        </label>
        <select
          id="quantity"
          value={quantity}
          onChange={(e) => setQuantity(parseInt(e.target.value, 10))}
          disabled={effectiveIsOutOfStock || isAdding}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
        >
          {Array.from({ length: Math.min(effectiveMaxQuantity, 10) }, (_, i) => i + 1).map((qty) => (
            <option key={qty} value={qty}>
              {qty}
            </option>
          ))}
        </select>
      </div>

      {/* Add to Cart Button */}
      <div className="flex gap-4">
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          disabled={effectiveIsOutOfStock || isAdding}
          onClick={handleAddToCart}
        >
          {isAdding ? 'Adding...' : effectiveIsOutOfStock ? 'Out of Stock' : 'Add to Cart'}
        </Button>
      </div>
    </div>
  );
}
