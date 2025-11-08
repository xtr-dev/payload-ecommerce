import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { ProductGrid } from '../../../../components/storefront/ProductGrid';
import { serializeProducts } from '../../../../lib/serialize';
import type { Product, Category } from '@/payload-types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function CategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const payload = await getPayload({ config: configPromise });

  // Fetch category
  const { docs: categoryDocs } = await payload.find({
    collection: 'categories',
    where: {
      slug: {
        equals: slug,
      },
    },
    limit: 1,
  });

  if (categoryDocs.length === 0) {
    notFound();
  }

  const category: Category = categoryDocs[0];

  // Fetch subcategories
  const { docs: subcategories } = await payload.find({
    collection: 'categories',
    where: {
      parent: {
        equals: category.id,
      },
    },
  });

  // Fetch products in this category
  const { docs: products, totalDocs } = await payload.find({
    collection: 'products',
    where: {
      and: [
        {
          status: {
            equals: 'active',
          },
        },
        {
          categories: {
            contains: category.id,
          },
        },
      ],
    },
    limit: 20,
    sort: '-createdAt',
  });

  // Serialize products for client components
  const transformedProducts = serializeProducts(products);

  // Get parent category for breadcrumb
  let parentCategory: Category | null = null;
  if (category.parent && typeof category.parent === 'object') {
    parentCategory = category.parent as Category;
  }

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
          {parentCategory && (
            <>
              <li>/</li>
              <li>
                <Link href={`/categories/${parentCategory.slug}`} className="hover:text-blue-600">
                  {parentCategory.name}
                </Link>
              </li>
            </>
          )}
          <li>/</li>
          <li className="text-gray-900 font-medium">{category.name}</li>
        </ol>
      </nav>

      {/* Category Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">{category.name}</h1>
        {category.description && (
          <p className="text-lg text-gray-600 max-w-3xl">{category.description}</p>
        )}
        <p className="text-sm text-gray-500 mt-2">{totalDocs} products</p>
      </div>

      {/* Subcategories */}
      {subcategories.length > 0 && (
        <div className="mb-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Subcategories</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {subcategories.map((subcat: Category) => (
              <Link
                key={subcat.id}
                href={`/categories/${subcat.slug}`}
                className="group bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow text-center"
              >
                <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition">
                  {subcat.name}
                </h3>
                {subcat.description && (
                  <p className="text-sm text-gray-600 mt-2 line-clamp-2">{subcat.description}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Products */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Products</h2>
        <ProductGrid
          products={transformedProducts}
          emptyMessage="No products found in this category."
        />
      </div>

      {/* View All Link */}
      {totalDocs > 20 && (
        <div className="mt-8 text-center">
          <Link
            href={`/products?category=${category.slug}`}
            className="inline-block px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 transition"
          >
            View All Products in {category.name} →
          </Link>
        </div>
      )}
    </div>
  );
}
