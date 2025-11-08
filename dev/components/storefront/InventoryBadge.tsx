import React from 'react';
import { Badge } from '../ui/Badge';

export interface InventoryBadgeProps {
  quantity: number;
  lowStockThreshold?: number;
  trackQuantity?: boolean;
  showCount?: boolean;
}

export function InventoryBadge({
  quantity,
  lowStockThreshold = 10,
  trackQuantity = true,
  showCount = false,
}: InventoryBadgeProps) {
  if (!trackQuantity) {
    return <Badge variant="success">In Stock</Badge>;
  }

  if (quantity === 0) {
    return <Badge variant="danger">Out of Stock</Badge>;
  }

  if (quantity <= lowStockThreshold) {
    return (
      <Badge variant="warning">
        Low Stock{showCount && ` (${quantity} left)`}
      </Badge>
    );
  }

  return (
    <Badge variant="success">
      In Stock{showCount && ` (${quantity} available)`}
    </Badge>
  );
}
