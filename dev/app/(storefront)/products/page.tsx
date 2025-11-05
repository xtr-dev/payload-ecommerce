import React from 'react'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '../../../../payload.config'

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: { category?: string; search?: string }
}) {
  const payload = await getPayload({ config })

  // Build query based on search params
  const where: any = {
    status: {
      equals: 'active',
    },
  }

  if (searchParams?.category) {
    where.categories = {
      contains: searchParams.category,
    }
  }

  if (searchParams?.search) {
    where.or = [
      {
        title: {
          contains: searchParams.search,
        },
      },
      {
        sku: {
          contains: searchParams.search,
        },
      },
    ]
  }

  // Fetch products
  const { docs: products, totalDocs } = await payload.find({
    collection: 'products',
    where,
    limit: 12,
    sort: '-createdAt',
  })

  // Fetch all categories for filter
  const { docs: categories } = await payload.find({
    collection: 'categories',
  })

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4">Products</h1>
        <p className="text-gray-600">Browse our collection of {totalDocs} products</p>
      </div>

      {/* Search and Filter */}
      <div className="mb-8 flex flex-col md:flex-row gap-4">
        <div className="flex-grow">
          <form action="/products" method="get">
            <input
              type="text"
              name="search"
              placeholder="Search products..."
              defaultValue={searchParams?.search}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </form>
        </div>
        <div>
          <select
            name="category"
            defaultValue={searchParams?.category || ''}
            onChange={(e) => {
              const url = new URL(window.location.href)
              if (e.target.value) {
                url.searchParams.set('category', e.target.value)
              } else {
                url.searchParams.delete('category')
              }
              window.location.href = url.toString()
            }}
            className="w-full md:w-auto px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
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
              {product.categories && product.categories.length > 0 && (
                <div className="mb-2">
                  {product.categories.map((cat: any) => (
                    <span
                      key={typeof cat === 'string' ? cat : cat.id}
                      className="inline-block bg-gray-100 rounded-full px-3 py-1 text-sm text-gray-700 mr-2"
                    >
                      {typeof cat === 'string' ? cat : cat.name}
                    </span>
                  ))}
                </div>
              )}
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
                  {product.inventoryQuantity > 0
                    ? `${product.inventoryQuantity} in stock`
                    : 'Out of Stock'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-600 text-lg">No products found</p>
          <Link href="/products" className="text-primary-600 hover:text-primary-700 mt-4 inline-block">
            Clear filters
          </Link>
        </div>
      )}
    </div>
  )
}
