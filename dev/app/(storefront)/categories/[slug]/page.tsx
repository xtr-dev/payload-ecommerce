import React from 'react'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '../../../../../payload.config'

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const payload = await getPayload({ config })

  // Find category by slug
  const { docs: categories } = await payload.find({
    collection: 'categories',
    where: {
      slug: {
        equals: params.slug,
      },
    },
  })

  const category = categories[0]

  if (!category) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <h1 className="text-2xl font-bold mb-4">Category Not Found</h1>
        <Link href="/categories" className="text-primary-600 hover:text-primary-700">
          Back to Categories
        </Link>
      </div>
    )
  }

  // Find products in this category
  const { docs: products, totalDocs } = await payload.find({
    collection: 'products',
    where: {
      and: [
        {
          categories: {
            contains: category.id,
          },
        },
        {
          status: {
            equals: 'active',
          },
        },
      ],
    },
    limit: 12,
  })

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Breadcrumb */}
      <nav className="mb-8 text-sm">
        <Link href="/" className="text-gray-600 hover:text-primary-600">
          Home
        </Link>
        <span className="mx-2 text-gray-400">/</span>
        <Link href="/categories" className="text-gray-600 hover:text-primary-600">
          Categories
        </Link>
        <span className="mx-2 text-gray-400">/</span>
        <span className="text-gray-900">{category.name}</span>
      </nav>

      {/* Category Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">{category.name}</h1>
        <p className="text-gray-600">
          {category.description} • {totalDocs} product{totalDocs !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Products Grid */}
      {products.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product) => (
            <Link
              key={product.id}
              href={`/products/${product.id}`}
              className="card hover:shadow-lg transition-shadow group"
            >
              <div className="mb-4">
                <div className="bg-gray-200 rounded-lg h-64 flex items-center justify-center">
                  <svg
                    className="w-24 h-24 text-gray-400"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
              </div>
              <h3 className="text-lg font-semibold mb-2 group-hover:text-primary-600 transition-colors">
                {product.title}
              </h3>
              <div className="flex items-center justify-between mt-4">
                <div>
                  <span className="text-2xl font-bold text-primary-600">
                    ${product.price.toFixed(2)}
                  </span>
                  {product.compareAtPrice && product.compareAtPrice > product.price && (
                    <span className="ml-2 text-sm text-gray-500 line-through">
                      ${product.compareAtPrice.toFixed(2)}
                    </span>
                  )}
                </div>
                <span
                  className={`text-sm ${product.inventoryQuantity > 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {product.inventoryQuantity > 0 ? 'In Stock' : 'Out of Stock'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg">No products in this category yet</p>
          <Link href="/products" className="text-primary-600 hover:text-primary-700 mt-4 inline-block">
            Browse all products
          </Link>
        </div>
      )}
    </div>
  )
}
