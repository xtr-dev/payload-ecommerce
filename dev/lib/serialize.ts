import type { Product } from '@/payload-types';

/**
 * Serialize a product for passing from server to client components
 * Removes non-serializable fields and converts to plain objects
 */
export function serializeProduct(product: Product) {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description ?? undefined,
    price: product.price,
    compareAtPrice: product.compareAtPrice ?? undefined,
    sku: product.sku ?? undefined,
    barcode: product.barcode ?? undefined,
    quantity: product.inventory?.quantity ?? undefined,
    lowStockThreshold: product.inventory?.lowStockThreshold ?? undefined,
    trackQuantity: product.inventory?.trackQuantity ?? false,
    images: product.images ? JSON.parse(JSON.stringify(product.images)) : undefined,
    categories: product.categories ? JSON.parse(JSON.stringify(product.categories)) : undefined,
    variants: product.variants ? JSON.parse(JSON.stringify(product.variants)) : undefined,
    status: product.status,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/**
 * Serialize an array of products
 */
export function serializeProducts(products: Product[]) {
  return products.map(serializeProduct);
}

/**
 * Deep clone and serialize any Payload data
 * Use this for complex nested objects
 */
export function serializePayloadData<T>(data: T): T {
  return JSON.parse(JSON.stringify(data));
}
