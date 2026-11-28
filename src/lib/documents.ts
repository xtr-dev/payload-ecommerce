import type { JsonObject, TypedCollection, TypeWithID } from 'payload'

/** A document of a collection whose fields are not known to TypeScript. */
export type UntypedDocument = JsonObject & TypeWithID

/**
 * The document types the server helpers return, by the plugin collection they come from.
 * Pass it to `getEcommerce` to type the results for collections that were renamed or
 * extended:
 *
 * ```ts
 * const ecommerce = getEcommerce<{ carts: ShopCart; orders: ShopOrder }>(payload)
 * ```
 *
 * A collection that is left out keeps its default type (see `EcommerceDocument`).
 */
export interface EcommerceDocumentTypes {
  carts?: object
  coupons?: object
  orders?: object
  products?: object
}

/**
 * The type the host's generated Payload types give the collection with this slug, or an
 * untyped document when there is none: the host has not generated types, or it renamed
 * the collection, so the plugin's default slug is not among its collections.
 *
 * This is resolved in the host's program, not when the plugin is built, which is why the
 * helper types below are written out instead of inferred from the implementation.
 */
type GeneratedDocument<TSlug extends string> = TSlug extends keyof TypedCollection
  ? TypedCollection[TSlug]
  : UntypedDocument

/**
 * The document type of one plugin collection: the one given in `TDocuments`, or else the
 * generated type of the collection with the plugin's default slug (`carts`, `coupons`,
 * `orders`, `products`).
 */
export type EcommerceDocument<
  TDocuments extends EcommerceDocumentTypes,
  TCollection extends keyof EcommerceDocumentTypes,
> = TDocuments extends Record<TCollection, infer TDocument> ? TDocument : GeneratedDocument<TCollection>
