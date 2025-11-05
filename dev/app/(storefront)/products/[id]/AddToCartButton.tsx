'use client'

import React, { useState } from 'react'

interface Product {
  id: string
  title: string
  price: number
  inventoryQuantity: number
}

export function AddToCartButton({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1)
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState('')

  const handleAddToCart = async () => {
    setAdding(true)
    setMessage('')

    try {
      const response = await fetch('/api/cart/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          productId: product.id,
          quantity,
        }),
      })

      if (response.ok) {
        setMessage('Added to cart!')
        setTimeout(() => setMessage(''), 3000)
      } else {
        setMessage('Failed to add to cart')
      }
    } catch (error) {
      setMessage('Error adding to cart')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <label className="font-medium">Quantity:</label>
        <div className="flex items-center border border-gray-300 rounded-lg">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            className="px-4 py-2 hover:bg-gray-100"
            disabled={quantity <= 1}
          >
            -
          </button>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 text-center border-x border-gray-300 py-2"
            min="1"
            max={product.inventoryQuantity}
          />
          <button
            onClick={() => setQuantity(Math.min(product.inventoryQuantity, quantity + 1))}
            className="px-4 py-2 hover:bg-gray-100"
            disabled={quantity >= product.inventoryQuantity}
          >
            +
          </button>
        </div>
      </div>

      <button
        onClick={handleAddToCart}
        disabled={adding || product.inventoryQuantity === 0}
        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {adding ? 'Adding...' : 'Add to Cart'}
      </button>

      {message && (
        <div
          className={`p-3 rounded-lg text-center ${
            message.includes('Failed') || message.includes('Error')
              ? 'bg-red-100 text-red-800'
              : 'bg-green-100 text-green-800'
          }`}
        >
          {message}
        </div>
      )}
    </div>
  )
}
