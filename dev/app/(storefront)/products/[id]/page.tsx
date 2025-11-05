import React from 'react'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '../../../../../payload.config'
import { AddToCartButton } from './AddToCartButton'

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const payload = await getPayload({ config })

  try {
    const product = await payload.findByID({
      collection: 'products',
      id: params.id,
    })

    if (!product) {
      return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
          <h1 className="text-2xl font-bold mb-4">Product Not Found</h1>
          <Link href="/products" className="text-primary-600 hover:text-primary-700">
            Back to Products
          </Link>
        </div>
      )
    }

    // Extract description text from Lexical format
    let descriptionText = ''
    if (product.description?.root?.children) {
      descriptionText = product.description.root.children
        .map((child: any) => {
          if (child.children) {
            return child.children.map((c: any) => c.text || '').join(' ')
          }
          return ''
        })
        .join('\n')
    }

    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Breadcrumb */}
        <nav className="mb-8 text-sm">
          <Link href="/" className="text-gray-600 hover:text-primary-600">
            Home
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <Link href="/products" className="text-gray-600 hover:text-primary-600">
            Products
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <span className="text-gray-900">{product.title}</span>
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Product Image */}
          <div>
            <div className="bg-gray-200 rounded-lg h-96 flex items-center justify-center">
              <svg
                className="w-32 h-32 text-gray-400"
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

          {/* Product Info */}
          <div>
            <h1 className="text-4xl font-bold mb-4">{product.title}</h1>

            {/* Categories */}
            {product.categories && product.categories.length > 0 && (
              <div className="mb-4">
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

            {/* Price */}
            <div className="mb-6">
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold text-primary-600">
                  ${product.price.toFixed(2)}
                </span>
                {product.compareAtPrice && product.compareAtPrice > product.price && (
                  <>
                    <span className="text-2xl text-gray-500 line-through">
                      ${product.compareAtPrice.toFixed(2)}
                    </span>
                    <span className="bg-red-100 text-red-800 text-sm font-semibold px-3 py-1 rounded-full">
                      Save ${(product.compareAtPrice - product.price).toFixed(2)}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Stock Status */}
            <div className="mb-6">
              {product.inventoryQuantity > 0 ? (
                <span className="text-green-600 font-medium">
                  ✓ In Stock ({product.inventoryQuantity} available)
                </span>
              ) : (
                <span className="text-red-600 font-medium">✗ Out of Stock</span>
              )}
            </div>

            {/* Description */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold mb-3">Description</h2>
              <p className="text-gray-700 whitespace-pre-line">{descriptionText}</p>
            </div>

            {/* Product Details */}
            <div className="mb-8 bg-gray-50 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Product Details</h2>
              <dl className="space-y-2">
                {product.sku && (
                  <div className="flex">
                    <dt className="font-medium w-32">SKU:</dt>
                    <dd className="text-gray-700">{product.sku}</dd>
                  </div>
                )}
                {product.barcode && (
                  <div className="flex">
                    <dt className="font-medium w-32">Barcode:</dt>
                    <dd className="text-gray-700">{product.barcode}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Variants */}
            {product.variants && product.variants.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-3">Available Variants</h2>
                <div className="space-y-2">
                  {product.variants.map((variant: any, index: number) => (
                    <div key={index} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                      <span className="font-medium">{variant.name}</span>
                      <span className="text-primary-600 font-semibold">
                        ${variant.price?.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add to Cart Button */}
            <AddToCartButton product={product} />

            <Link
              href="/products"
              className="mt-4 inline-block text-primary-600 hover:text-primary-700"
            >
              ← Back to Products
            </Link>
          </div>
        </div>
      </div>
    )
  } catch (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <h1 className="text-2xl font-bold mb-4">Error Loading Product</h1>
        <p className="text-gray-600 mb-4">There was an error loading this product.</p>
        <Link href="/products" className="text-primary-600 hover:text-primary-700">
          Back to Products
        </Link>
      </div>
    )
  }
}
