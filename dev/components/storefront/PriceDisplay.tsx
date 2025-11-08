import React from 'react';
import { formatPrice, calculateDiscountPercentage } from '../../lib/formatters';

export interface PriceDisplayProps {
  price: number;
  compareAtPrice?: number;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
  showDiscount?: boolean;
}

export function PriceDisplay({
  price,
  compareAtPrice,
  currency = 'USD',
  size = 'md',
  showDiscount = true,
}: PriceDisplayProps) {
  const hasDiscount = compareAtPrice && compareAtPrice > price;
  const discountPercentage = hasDiscount ? calculateDiscountPercentage(price, compareAtPrice) : 0;

  const sizeStyles = {
    sm: {
      price: 'text-base',
      compareAt: 'text-sm',
      discount: 'text-xs',
    },
    md: {
      price: 'text-lg',
      compareAt: 'text-base',
      discount: 'text-sm',
    },
    lg: {
      price: 'text-2xl',
      compareAt: 'text-lg',
      discount: 'text-base',
    },
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`font-semibold text-gray-900 ${sizeStyles[size].price}`}>
        {formatPrice(price, currency)}
      </span>
      {hasDiscount && (
        <>
          <span className={`font-medium text-gray-500 line-through ${sizeStyles[size].compareAt}`}>
            {formatPrice(compareAtPrice, currency)}
          </span>
          {showDiscount && (
            <span className={`font-medium text-green-600 ${sizeStyles[size].discount}`}>
              Save {discountPercentage}%
            </span>
          )}
        </>
      )}
    </div>
  );
}
