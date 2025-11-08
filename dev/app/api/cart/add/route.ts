import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { useEcommerce } from 'payload-ecommerce';

export async function POST(request: Request) {
  try {
    const payload = await getPayload({ config: configPromise });
    const ecommerce = useEcommerce(payload);

    const body = await request.json();
    const { productId: rawProductId, quantity = 1, variant } = body;

    if (!rawProductId) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    // Convert product ID to number for SQLite
    const productId = typeof rawProductId === 'string' ? parseInt(rawProductId, 10) : rawProductId;

    // For demo purposes, we'll use a session-based cart (no user authentication required)
    // In a real app, you would get the user ID from the session/auth
    const sessionId = request.headers.get('x-session-id') || 'demo-session';

    // Add item to cart using the plugin's utility
    // The plugin handles finding or creating the cart internally
    const updatedCart = await ecommerce.cart.addToCart({
      sessionId,
      productId,
      quantity,
      variant,
    });

    // Calculate and update subtotal
    const cartWithDetails = await payload.findByID({
      collection: 'carts',
      id: updatedCart.id,
      depth: 2,
    });

    let subtotal = 0;
    if (cartWithDetails.items) {
      for (const item of cartWithDetails.items) {
        const product = typeof item.product === 'object' ? item.product : null;
        if (product) {
          subtotal += product.price * item.quantity;
        }
      }
    }

    await payload.update({
      collection: 'carts',
      id: updatedCart.id,
      data: { subtotal },
    });

    // Refetch cart with full product details for response
    const finalCart = await payload.findByID({
      collection: 'carts',
      id: updatedCart.id,
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
      success: true,
      cart: {
        ...finalCart,
        subtotal: finalSubtotal,
      }
    });
  } catch (error: any) {
    console.error('Error adding to cart:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to add item to cart' },
      { status: 500 }
    );
  }
}
