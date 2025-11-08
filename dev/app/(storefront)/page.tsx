import React from 'react';
import Link from 'next/link';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { ProductGrid } from '../../components/storefront/ProductGrid';
import { Button } from '../../components/ui/Button';
import { serializeProducts } from '../../lib/serialize';
import type { Product } from '@/payload-types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const payload = await getPayload({ config: configPromise });

  // Fetch featured products (first 8 active products)
  const { docs: products } = await payload.find({
    collection: 'products',
    where: {
      status: {
        equals: 'active',
      },
    },
    limit: 8,
    sort: '-createdAt',
    depth: 2,
  });

  // Fetch main categories
  const { docs: categories } = await payload.find({
    collection: 'categories',
    where: {
      parent: {
        exists: false,
      },
    },
    limit: 3,
  });

  // Serialize products for client components
  const transformedProducts = serializeProducts(products);

  return (
    <div>
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-blue-600 to-blue-800 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
              Welcome to ShopDemo
            </h1>
            <p className="text-xl md:text-2xl mb-8 text-blue-100">
              Discover amazing products at great prices
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/products">
                <Button variant="primary" size="lg">
                  Shop Now
                </Button>
              </Link>
              <Link href="/categories/electronics">
                <Button variant="secondary" size="lg">
                  Browse Electronics
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Categories Section */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-8 text-center">Shop by Category</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/categories/${category.slug}`}
                className="group relative overflow-hidden rounded-lg shadow-md hover:shadow-xl transition-shadow bg-white p-8 text-center border border-gray-200"
              >
                <div className="relative z-10">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition">
                    {category.name}
                  </h3>
                  <p className="text-gray-600">{category.description}</p>
                  <span className="inline-block mt-4 text-blue-600 font-medium group-hover:underline">
                    Explore →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Products Section */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900">Featured Products</h2>
            <Link href="/products" className="text-blue-600 hover:text-blue-700 font-medium">
              View All →
            </Link>
          </div>
          <ProductGrid products={transformedProducts} />
        </div>
      </section>

      {/* Promo Banner */}
      <section className="py-16 bg-blue-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold mb-4">Get 10% off your first order!</h2>
          <p className="text-xl mb-6 text-blue-100">
            Use code <span className="font-mono font-bold bg-white text-blue-600 px-3 py-1 rounded">WELCOME10</span> at checkout
          </p>
          <Link href="/products">
            <Button variant="primary" size="lg">
              Start Shopping
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
