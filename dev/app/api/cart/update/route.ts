import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import configPromise from '@payload-config';

export async function POST(request: Request) {
  try {
    const payload = await getPayload({ config: configPromise });

    const body = await request.json();
    const { productId: rawProductId, quantity, variant } = body;

    if (!rawProductId || quantity === undefined) {
      return NextResponse.json(
        { error: 'Product ID and quantity are required' },
        { status: 400 }
      );
    }

    // Convert product ID to number for SQLite
    const productId = typeof rawProductId === 'string' ? parseInt(rawProductId, 10) : rawProductId;

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

    // Update item manually since we need to handle the product ID comparison properly
    const items = cart.items || [];
    const itemIndex = items.findIndex((item: any) => {
      const itemProductId = typeof item.product === 'object' ? item.product.id : item.product;
      return itemProductId === productId && (variant ? item.variant === variant : !item.variant);
    });

    if (itemIndex === -1) {
      return NextResponse.json({ error: 'Item not found in cart' }, { status: 404 });
    }

    if (quantity <= 0) {
      items.splice(itemIndex, 1);
    } else {
      items[itemIndex].quantity = quantity;
    }

    // Calculate subtotal
    const cartWithDetails = await payload.findByID({
      collection: 'carts',
      id: cart.id,
      depth: 2,
    });

    let subtotal = 0;
    for (const item of items) {
      // Find the product details from the fetched cart
      const cartItem = cartWithDetails.items?.find((ci: any) => {
        const ciProductId = typeof ci.product === 'object' ? ci.product.id : ci.product;
        const itemProductId = typeof item.product === 'object' ? item.product.id : item.product;
        return ciProductId === itemProductId && ci.variant === item.variant;
      });

      if (cartItem) {
        const product = typeof cartItem.product === 'object' ? cartItem.product : null;
        if (product) {
          subtotal += product.price * item.quantity;
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
        if (item.product && typeof item.product === 'object' && item.product.price) {
          finalSubtotal += item.product.price * (item.quantity || 1);
        }
      }
    }

    return NextResponse.json({
      ...finalCart,
      subtotal: finalSubtotal,
    });
  } catch (error: any) {
    console.error('Error updating cart:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update cart item' },
      { status: 500 }
    );
  }
}
