'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PriceDisplay } from './PriceDisplay';
import { InventoryBadge } from './InventoryBadge';
import { Button } from '../ui/Button';

export interface Product {
  id: string;
  title: string;
  slug: string;
  price: number;
  compareAtPrice?: number;
  quantity?: number;
  lowStockThreshold?: number;
  trackQuantity?: boolean;
  images?: any[];
  status?: string;
}

export interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  const router = useRouter();
  const isOutOfStock = product.trackQuantity && (product.quantity ?? 0) === 0;
  const imageUrl = product.images?.[0]?.url || '/placeholder-product.jpg';

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (isOutOfStock) return;

    try {
      const response = await fetch('/api/cart/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': 'demo-session',
        },
        body: JSON.stringify({
          productId: product.id,
          quantity: 1,
        }),
      });

      if (response.ok) {
        // Optionally show a success message or redirect to cart
        // For now, just refresh to update cart count in navigation
        router.refresh();
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
    }
  };

  return (
    <Link href={`/products/${product.slug}`}>
      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden transition-all duration-200 hover:shadow-lg h-full flex flex-col">
        {/* Product Image */}
        <div className="relative aspect-square bg-gray-100">
          <img
            src={imageUrl}
            alt={product.title}
            className="w-full h-full object-cover"
          />
          {product.compareAtPrice && product.compareAtPrice > product.price && (
            <div className="absolute top-2 right-2 bg-red-500 text-white px-2 py-1 rounded-md text-sm font-bold">
              SALE
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="p-4 flex flex-col flex-grow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
            {product.title}
          </h3>

          <div className="mb-3">
            <PriceDisplay
              price={product.price}
              compareAtPrice={product.compareAtPrice}
              size="md"
            />
          </div>

          <div className="mb-3">
            <InventoryBadge
              quantity={product.quantity ?? 0}
              lowStockThreshold={product.lowStockThreshold}
              trackQuantity={product.trackQuantity}
            />
          </div>

          <div className="mt-auto">
            <Button
              variant="primary"
              className="w-full"
              disabled={isOutOfStock}
              onClick={handleAddToCart}
            >
              {isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
            </Button>
          </div>
        </div>
      </div>
    </Link>
  );
}
