import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { PriceDisplay } from '../../../../components/storefront/PriceDisplay';
import { InventoryBadge } from '../../../../components/storefront/InventoryBadge';
import { AddToCartForm } from '../../../../components/storefront/AddToCartForm';
import { ProductGrid } from '../../../../components/storefront/ProductGrid';
import { serializeProducts } from '../../../../lib/serialize';
import type { Product } from '@/payload-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const payload = await getPayload({ config: configPromise });

  // Fetch product
  const { docs } = await payload.find({
    collection: 'products',
    where: {
      slug: {
        equals: slug,
      },
    },
    limit: 1,
  });

  if (docs.length === 0) {
    notFound();
  }

  const product: Product = docs[0];

  // Fetch related products from same categories
  let relatedProducts: any[] = [];
  if (product.categories && product.categories.length > 0) {
    const categoryId = typeof product.categories[0] === 'string'
      ? product.categories[0]
      : product.categories[0].id;

    const { docs: related } = await payload.find({
      collection: 'products',
      where: {
        and: [
          {
            status: {
              equals: 'active',
            },
          },
          {
            id: {
              not_equals: product.id,
            },
          },
          {
            categories: {
              contains: categoryId,
            },
          },
        ],
      },
      limit: 4,
    });

    relatedProducts = serializeProducts(related);
  }

  // Properly handle inventory values from database
  const trackQuantity = Boolean(product.trackQuantity);
  const quantity = product.quantity ?? 0;
  const isOutOfStock = trackQuantity && quantity === 0;
  const mainImage = product.images?.[0];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm">
        <ol className="flex items-center space-x-2 text-gray-600">
          <li>
            <Link href="/" className="hover:text-blue-600">
              Home
            </Link>
          </li>
          <li>/</li>
          <li>
            <Link href="/products" className="hover:text-blue-600">
              Products
            </Link>
          </li>
          <li>/</li>
          <li className="text-gray-900 font-medium">{product.title}</li>
        </ol>
      </nav>

      {/* Product Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
        {/* Image Section */}
        <div>
          <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden mb-4">
            {mainImage ? (
              <img
                src={typeof mainImage === 'string' ? mainImage : mainImage.url}
                alt={product.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                No image available
              </div>
            )}
          </div>
        </div>

        {/* Product Info */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{product.title}</h1>

          {/* Price */}
          <div className="mb-6">
            <PriceDisplay
              price={product.price}
              compareAtPrice={product.compareAtPrice}
              size="lg"
            />
          </div>

          {/* SKU and Availability */}
          <div className="mb-6 space-y-2">
            {product.sku && (
              <p className="text-sm text-gray-600">
                SKU: <span className="font-mono font-medium">{product.sku}</span>
              </p>
            )}
            <div>
              <InventoryBadge
                quantity={quantity}
                lowStockThreshold={product.lowStockThreshold ?? 10}
                trackQuantity={trackQuantity}
                showCount={true}
              />
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Description</h2>
              <p className="text-gray-700">{product.description}</p>
            </div>
          )}

          {/* Variants */}
          {product.variants && product.variants.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Available Variants</h3>
              <div className="grid grid-cols-2 gap-2">
                {product.variants.map((variant: any, index: number) => {
                  const variantPrice = variant.price || product.price;
                  const variantQuantity = variant.quantity ?? quantity;
                  const variantOutOfStock = trackQuantity && variantQuantity === 0;

                  return (
                    <div
                      key={index}
                      className={`border rounded-md p-3 ${
                        variantOutOfStock
                          ? 'border-gray-200 bg-gray-50'
                          : 'border-gray-300 hover:border-blue-500 cursor-pointer'
                      }`}
                    >
                      <div className="font-medium text-sm text-gray-900">{variant.name}</div>
                      {variant.price && (
                        <div className="text-sm text-gray-600 mt-1">
                          ${variantPrice.toFixed(2)}
                        </div>
                      )}
                      {variantOutOfStock && (
                        <div className="text-xs text-red-600 mt-1">Out of Stock</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quantity Selector and Add to Cart */}
          <AddToCartForm
            productId={product.id}
            isOutOfStock={isOutOfStock}
            maxQuantity={trackQuantity ? quantity : 10}
          />

          {/* Additional Info */}
          <div className="mt-8 pt-8 border-t border-gray-200">
            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Free shipping on orders over $100</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>30-day return policy</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Secure checkout</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Related Products */}
      {relatedProducts.length > 0 && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Related Products</h2>
            <Link href="/products" className="text-blue-600 hover:text-blue-700 font-medium">
              View All →
            </Link>
          </div>
          <ProductGrid products={relatedProducts} />
        </div>
      )}
    </div>
  );
}
