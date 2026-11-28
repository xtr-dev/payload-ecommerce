import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { getEcommerce } from 'payload-ecommerce';
import { toCouponPreview } from '@/lib/couponPreview';

export async function POST(request: Request) {
  try {
    const payload = await getPayload({ config: configPromise });
    const ecommerce = getEcommerce(payload);

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

    // The result contains the whole coupon document; the browser only gets a selection.
    return NextResponse.json(toCouponPreview(result));
  } catch (error: any) {
    console.error('Error validating coupon:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to validate coupon' },
      { status: 500 }
    );
  }
}
