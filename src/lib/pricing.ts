/** The parts of a product document that decide what one unit costs. */
export interface PricedProduct {
  price?: null | number
  variants?: Array<{ name?: null | string; price?: null | number }> | null
}

/**
 * The price of one unit of `product`, optionally in the variant named `variant`. This is
 * the only place a cart or order line is priced, so the cart subtotal, the order created
 * from a cart and a storefront that shows line prices all agree.
 *
 * A variant's own `price` replaces the product's price when it is filled in, including an
 * explicit 0 (a free variant). A line without a variant, with a variant name the product
 * does not have, or with a variant whose `price` is left empty costs the product's `price`.
 * A product without a numeric price costs 0. Variants are matched by `name`, the same way
 * stock is (see `resolveStockTarget`).
 *
 * This file has no imports so that client components can use it without bundling
 * server-only code.
 */
export const resolveUnitPrice = (
  product: null | PricedProduct | undefined,
  variant?: null | string,
): number => {
  if (variant) {
    const variantData = (product?.variants || []).find((candidate) => candidate?.name === variant)
    if (typeof variantData?.price === 'number' && Number.isFinite(variantData.price)) {
      return variantData.price
    }
  }

  return typeof product?.price === 'number' && Number.isFinite(product.price) ? product.price : 0
}
