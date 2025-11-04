import type { Payload } from 'payload'

export interface GetProductsParams {
  category?: string
  status?: 'draft' | 'active' | 'archived'
  minPrice?: number
  maxPrice?: number
  search?: string
  limit?: number
  page?: number
}

export const createProductHelpers = (payload: Payload, productsSlug = 'products') => {
  const getProduct = async (id: string) => {
    return await payload.findByID({
      collection: productsSlug,
      id,
      depth: 2,
    })
  }

  const getProducts = async (params: GetProductsParams = {}) => {
    const { category, status, minPrice, maxPrice, search, limit = 10, page = 1 } = params

    const where: any = {}

    if (category) {
      where.categories = { contains: category }
    }

    if (status) {
      where.status = { equals: status }
    } else {
      where.status = { equals: 'active' }
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {}
      if (minPrice !== undefined) {
        where.price.greater_than_equal = minPrice
      }
      if (maxPrice !== undefined) {
        where.price.less_than_equal = maxPrice
      }
    }

    if (search) {
      where.or = [
        {
          title: {
            contains: search,
          },
        },
        {
          description: {
            contains: search,
          },
        },
        {
          sku: {
            contains: search,
          },
        },
      ]
    }

    return await payload.find({
      collection: productsSlug,
      where,
      limit,
      page,
      depth: 2,
    })
  }

  const checkInventory = async (productId: string, quantity: number, variant?: string) => {
    const product = await payload.findByID({
      collection: productsSlug,
      id: productId,
    })

    if (!product) {
      throw new Error('Product not found')
    }

    if (!product.inventory?.trackQuantity) {
      return { available: true, quantity: Infinity }
    }

    if (variant && product.variants) {
      const variantData = product.variants.find((v: any) => v.name === variant)
      if (variantData) {
        const available = variantData.inventory >= quantity
        return { available, quantity: variantData.inventory }
      }
    }

    const available = (product.inventory?.quantity || 0) >= quantity
    return { available, quantity: product.inventory?.quantity || 0 }
  }

  const reduceInventory = async (productId: string, quantity: number, variant?: string) => {
    const product = await payload.findByID({
      collection: productsSlug,
      id: productId,
    })

    if (!product || !product.inventory?.trackQuantity) {
      return product
    }

    if (variant && product.variants) {
      const variants = [...product.variants]
      const variantIndex = variants.findIndex((v: any) => v.name === variant)

      if (variantIndex !== -1) {
        variants[variantIndex].inventory -= quantity
        return await payload.update({
          collection: productsSlug,
          id: productId,
          data: { variants },
        })
      }
    }

    const newQuantity = (product.inventory?.quantity || 0) - quantity

    return await payload.update({
      collection: productsSlug,
      id: productId,
      data: {
        inventory: {
          ...product.inventory,
          quantity: Math.max(0, newQuantity),
        },
      },
    })
  }

  const restoreInventory = async (productId: string, quantity: number, variant?: string) => {
    const product = await payload.findByID({
      collection: productsSlug,
      id: productId,
    })

    if (!product || !product.inventory?.trackQuantity) {
      return product
    }

    if (variant && product.variants) {
      const variants = [...product.variants]
      const variantIndex = variants.findIndex((v: any) => v.name === variant)

      if (variantIndex !== -1) {
        variants[variantIndex].inventory += quantity
        return await payload.update({
          collection: productsSlug,
          id: productId,
          data: { variants },
        })
      }
    }

    const newQuantity = (product.inventory?.quantity || 0) + quantity

    return await payload.update({
      collection: productsSlug,
      id: productId,
      data: {
        inventory: {
          ...product.inventory,
          quantity: newQuantity,
        },
      },
    })
  }

  return {
    getProduct,
    getProducts,
    checkInventory,
    reduceInventory,
    restoreInventory,
  }
}
