import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { useEcommerce } from 'payload-ecommerce';

export async function POST(request: Request) {
  try {
    const payload = await getPayload({ config: configPromise });
    const ecommerce = useEcommerce(payload);

    const body = await request.json();
    const { code, cartTotal, productIds, userId } = body;

    if (!code) {
      return NextResponse.json({ error: 'Coupon code is required' }, { status: 400 });
    }

    // Validate coupon using the plugin's utility
    const result = await ecommerce.coupons.validateCoupon({
      code,
      cartTotal: cartTotal || 0,
      productIds: productIds || [],
      userId,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error validating coupon:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to validate coupon' },
      { status: 500 }
    );
  }
}
