import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import configPromise from '@payload-config';

export async function GET(request: Request) {
  try {
    const payload = await getPayload({ config: configPromise });

    const sessionId = request.headers.get('x-session-id') || 'demo-session';

    // Find cart for this session
    const { docs: carts } = await payload.find({
      collection: 'carts',
      where: {
        sessionId: {
          equals: sessionId,
        },
      },
      limit: 1,
      depth: 2, // Populate product and variant details
    });

    if (carts.length === 0) {
      // Return empty cart structure
      return NextResponse.json({
        items: [],
        subtotal: 0,
      });
    }

    const cart = carts[0];

    // Calculate subtotal from items to ensure it's always up-to-date
    let subtotal = 0;
    if (cart.items && Array.isArray(cart.items)) {
      for (const item of cart.items) {
        if (item.product && typeof item.product === 'object' && item.product.price) {
          subtotal += item.product.price * (item.quantity || 1);
        }
      }
    }

    // Return cart with calculated subtotal
    return NextResponse.json({
      ...cart,
      subtotal,
    });
  } catch (error: any) {
    console.error('Error fetching cart:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch cart' },
      { status: 500 }
    );
  }
}
