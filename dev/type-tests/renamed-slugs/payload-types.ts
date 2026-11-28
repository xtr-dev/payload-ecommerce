// A hand-written stand-in for the generated types of a host that renamed the plugin's
// collections, reduced to what the type test needs. `orders` is a collection of the
// host's own that happens to have one of the plugin's default slugs.
export interface ShopCart {
  id: number
  items?: { product: number; quantity: number }[] | null
}
export interface ShopOrder {
  id: number
  total: number
}
export interface ShopProduct {
  id: number
  title: string
}
export interface ShopCoupon {
  code: string
  id: number
}
export interface PurchaseOrder {
  id: number
  supplier: string
}

export interface Config {
  collections: {
    orders: PurchaseOrder
    'shop-carts': ShopCart
    'shop-coupons': ShopCoupon
    'shop-orders': ShopOrder
    'shop-products': ShopProduct
  }
}

declare module 'payload' {
  export interface GeneratedTypes extends Config {}
}
