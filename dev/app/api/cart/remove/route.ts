import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { isSameCartLine, resolveUnitPrice } from 'payload-ecommerce';

export async function POST(request: Request) {
  try {
    const payload = await getPayload({ config: configPromise });

    const body = await request.json();
    const { productId, variant } = body;

    if (!productId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    const sessionId = request.headers.get('x-session-id') || 'demo-session';

    // Find cart
    const { docs: carts } = await payload.find({
      collection: 'carts',
      where: {
        sessionId: {
          equals: sessionId,
        },
      },
      limit: 1,
    });

    if (carts.length === 0) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
    }

    const cart = carts[0];

    // Remove item manually
    const items = (cart.items || []).filter((item: any) => !isSameCartLine(item, productId, variant));

    // Calculate subtotal
    const cartWithDetails = await payload.findByID({
      collection: 'carts',
      id: cart.id,
      depth: 2,
    });

    let subtotal = 0;
    for (const item of items) {
      // Find the product details from the fetched cart
      const cartItem = cartWithDetails.items?.find((ci: any) => isSameCartLine(ci, item.product, item.variant));

      if (cartItem) {
        const product = typeof cartItem.product === 'object' ? cartItem.product : null;
        if (product) {
          subtotal += resolveUnitPrice(product, item.variant) * item.quantity;
        }
      }
    }

    await payload.update({
      collection: 'carts',
      id: cart.id,
      data: { items, subtotal },
    });

    // Refetch cart with full product details for response
    const finalCart = await payload.findByID({
      collection: 'carts',
      id: cart.id,
      depth: 2,
    });

    // Recalculate subtotal to ensure it's accurate
    let finalSubtotal = 0;
    if (finalCart.items && Array.isArray(finalCart.items)) {
      for (const item of finalCart.items) {
        if (item.product && typeof item.product === 'object') {
          finalSubtotal += resolveUnitPrice(item.product, item.variant) * (item.quantity || 1);
        }
      }
    }

    return NextResponse.json({
      ...finalCart,
      subtotal: finalSubtotal,
    });
  } catch (error: any) {
    console.error('Error removing from cart:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to remove item from cart' },
      { status: 500 }
    );
  }
}
