import React from 'react';
import Link from 'next/link';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { ProductGrid } from '../../../components/storefront/ProductGrid';
import { SortSelect } from '../../../components/storefront/SortSelect';
import { serializeProducts } from '../../../lib/serialize';
import type { Product, Category } from '@/payload-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    category?: string;
    search?: string;
    sort?: string;
    page?: string;
  }>;
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const payload = await getPayload({ config: configPromise });

  const page = parseInt(params.page || '1');
  const limit = 12;

  // Build query
  const where: any = {
    status: {
      equals: 'active',
    },
  };

  if (params.search) {
    where.title = {
      contains: params.search,
    };
  }

  if (params.category) {
    const category = await payload.find({
      collection: 'categories',
      where: {
        slug: {
          equals: params.category,
        },
      },
      limit: 1,
    });

    if (category.docs.length > 0) {
      where.categories = {
        contains: category.docs[0].id,
      };
    }
  }

  // Determine sort
  let sort: string = '-createdAt';
  if (params.sort === 'price_asc') sort = 'price';
  else if (params.sort === 'price_desc') sort = '-price';
  else if (params.sort === 'name') sort = 'title';
  else if (params.sort === 'newest') sort = '-createdAt';

  // Fetch products
  const { docs: products, totalDocs, totalPages } = await payload.find({
    collection: 'products',
    where,
    limit,
    page,
    sort,
    depth: 2,
  });

  // Fetch all categories for filter
  const { docs: categories } = await payload.find({
    collection: 'categories',
    limit: 100,
    sort: 'name',
  });

  // Serialize products for client components
  const transformedProducts = serializeProducts(products);

  // Build filter URL
  const buildFilterUrl = (newParams: Record<string, string>) => {
    const urlParams = new URLSearchParams();
    Object.entries({ ...params, ...newParams }).forEach(([key, value]) => {
      if (value) urlParams.set(key, value);
    });
    return `/products?${urlParams.toString()}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">All Products</h1>
        <p className="text-gray-600">
          Showing {(page - 1) * limit + 1}-{Math.min(page * limit, totalDocs)} of {totalDocs} products
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Filters */}
        <aside className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 sticky top-20">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Filters</h2>

            {/* Category Filter */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Category</h3>
              <div className="space-y-2">
                <Link
                  href="/products"
                  className={`block px-3 py-2 rounded-md text-sm ${
                    !params.category
                      ? 'bg-blue-100 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  All Categories
                </Link>
                {categories.map((category: Category) => (
                  <Link
                    key={category.id}
                    href={buildFilterUrl({ category: category.slug, page: '1' })}
                    className={`block px-3 py-2 rounded-md text-sm ${
                      params.category === category.slug
                        ? 'bg-blue-100 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {category.name}
                  </Link>
                ))}
              </div>
            </div>

            {/* Active Filters */}
            {(params.category || params.search) && (
              <div className="pt-4 border-t border-gray-200">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">Active Filters</h3>
                  <Link href="/products" className="text-xs text-blue-600 hover:text-blue-700">
                    Clear All
                  </Link>
                </div>
                <div className="space-y-2">
                  {params.search && (
                    <div className="flex items-center justify-between bg-gray-100 rounded px-3 py-2">
                      <span className="text-sm text-gray-700">
                        Search: <span className="font-medium">{params.search}</span>
                      </span>
                      <Link
                        href={buildFilterUrl({ search: '' })}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        ×
                      </Link>
                    </div>
                  )}
                  {params.category && (
                    <div className="flex items-center justify-between bg-gray-100 rounded px-3 py-2">
                      <span className="text-sm text-gray-700">
                        Category: <span className="font-medium">{params.category}</span>
                      </span>
                      <Link
                        href={buildFilterUrl({ category: '' })}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        ×
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Products Grid */}
        <div className="lg:col-span-3">
          {/* Sort and View Options */}
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4 mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="text-sm text-gray-600">
                {totalDocs} {totalDocs === 1 ? 'product' : 'products'} found
              </div>
              <SortSelect currentSort={params.sort} currentParams={params} />
            </div>
          </div>

          {/* Product Grid */}
          <ProductGrid
            products={transformedProducts}
            emptyMessage="No products match your criteria. Try adjusting your filters."
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-8 flex justify-center gap-2">
              {page > 1 && (
                <Link
                  href={buildFilterUrl({ page: (page - 1).toString() })}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 font-medium"
                >
                  ← Previous
                </Link>
              )}
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <Link
                  key={p}
                  href={buildFilterUrl({ page: p.toString() })}
                  className={`px-4 py-2 border rounded-md font-medium ${
                    p === page
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </Link>
              ))}
              {page < totalPages && (
                <Link
                  href={buildFilterUrl({ page: (page + 1).toString() })}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 font-medium"
                >
                  Next →
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
