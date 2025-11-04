'use client'

import React from 'react'

export const BeforeDashboardClient: React.FC = () => {
  return (
    <div
      style={{
        backgroundColor: '#f0f0f0',
        border: '1px solid #ccc',
        borderRadius: '4px',
        margin: '1rem',
        padding: '1rem',
      }}
    >
      <h3>Payload Ecommerce Plugin</h3>
      <p>Welcome to your eCommerce dashboard</p>
    </div>
  )
}

/**
 * Client-side hooks for React components
 * These hooks interact with the Payload REST API
 */

interface UseCartOptions {
  serverURL?: string
}

export const useCart = ({ serverURL = '' }: UseCartOptions = {}) => {
  const [cart, setCart] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const fetchCart = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${serverURL}/api/carts/me`, {
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error('Failed to fetch cart')
      }
      const data = await response.json()
      setCart(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [serverURL])

  const addToCart = React.useCallback(
    async (productId: string, quantity: number, variant?: string) => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`${serverURL}/api/cart/add`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ productId, quantity, variant }),
        })
        if (!response.ok) {
          throw new Error('Failed to add to cart')
        }
        const data = await response.json()
        setCart(data)
        return data
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        throw err
      } finally {
        setLoading(false)
      }
    },
    [serverURL],
  )

  const updateCartItem = React.useCallback(
    async (productId: string, quantity: number) => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`${serverURL}/api/cart/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ productId, quantity }),
        })
        if (!response.ok) {
          throw new Error('Failed to update cart')
        }
        const data = await response.json()
        setCart(data)
        return data
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        throw err
      } finally {
        setLoading(false)
      }
    },
    [serverURL],
  )

  const removeFromCart = React.useCallback(
    async (productId: string, variant?: string) => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`${serverURL}/api/cart/remove`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ productId, variant }),
        })
        if (!response.ok) {
          throw new Error('Failed to remove from cart')
        }
        const data = await response.json()
        setCart(data)
        return data
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        throw err
      } finally {
        setLoading(false)
      }
    },
    [serverURL],
  )

  return {
    cart,
    loading,
    error,
    fetchCart,
    addToCart,
    updateCartItem,
    removeFromCart,
  }
}

export const useProducts = ({ serverURL = '' }: UseCartOptions = {}) => {
  const [products, setProducts] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const fetchProducts = React.useCallback(
    async (params: Record<string, any> = {}) => {
      setLoading(true)
      setError(null)
      try {
        const queryParams = new URLSearchParams(params).toString()
        const response = await fetch(`${serverURL}/api/products?${queryParams}`, {
          credentials: 'include',
        })
        if (!response.ok) {
          throw new Error('Failed to fetch products')
        }
        const data = await response.json()
        setProducts(data.docs || [])
        return data
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        throw err
      } finally {
        setLoading(false)
      }
    },
    [serverURL],
  )

  const getProduct = React.useCallback(
    async (id: string) => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`${serverURL}/api/products/${id}`, {
          credentials: 'include',
        })
        if (!response.ok) {
          throw new Error('Failed to fetch product')
        }
        return await response.json()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        throw err
      } finally {
        setLoading(false)
      }
    },
    [serverURL],
  )

  return {
    products,
    loading,
    error,
    fetchProducts,
    getProduct,
  }
}

export const useOrders = ({ serverURL = '' }: UseCartOptions = {}) => {
  const [orders, setOrders] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const fetchOrders = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${serverURL}/api/orders/me`, {
        credentials: 'include',
      })
      if (!response.ok) {
        throw new Error('Failed to fetch orders')
      }
      const data = await response.json()
      setOrders(data.docs || [])
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    } finally {
      setLoading(false)
    }
  }, [serverURL])

  const getOrder = React.useCallback(
    async (id: string) => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`${serverURL}/api/orders/${id}`, {
          credentials: 'include',
        })
        if (!response.ok) {
          throw new Error('Failed to fetch order')
        }
        return await response.json()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        throw err
      } finally {
        setLoading(false)
      }
    },
    [serverURL],
  )

  return {
    orders,
    loading,
    error,
    fetchOrders,
    getOrder,
  }
}
