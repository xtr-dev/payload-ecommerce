import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { useEcommerce } from 'payload-ecommerce';
import {NextResponse} from "next/server"

export async function POST(request: Request) {
  try {
    const payload = await getPayload({ config: configPromise });
    const ecommerce = useEcommerce(payload);

    const body = await request.json();
    const { shippingAddress, billingAddress, paymentMethod, couponCode } = body;

    if (!shippingAddress || !billingAddress) {
      return NextResponse.json(
        { error: 'Shipping address and billing address are required' },
        { status: 400 }
      );
    }

    // Get cart from session
    const sessionId = request.headers.get('x-session-id') || 'demo-session';

    const { docs: carts } = await payload.find({
      collection: 'carts',
      where: {
        sessionId: {
          equals: sessionId,
        },
      },
      limit: 1,
      depth: 2,
    });

    if (carts.length === 0) {
      return NextResponse.json(
        { error: 'Cart not found' },
        { status: 404 }
      );
    }

    const cart = carts[0];

    if (!cart || !cart.items || cart.items.length === 0) {
      return NextResponse.json(
        { error: 'Cart is empty or not found' },
        { status: 400 }
      );
    }

    // Calculate totals
    const subtotal = cart.subtotal || 0;
    let discount = 0;
    let discountCouponId: string | undefined;

    // Validate and apply coupon if provided
    if (couponCode) {
      const productIds = cart.items.map((item: any) =>
        typeof item.product === 'string' ? item.product : item.product.id
      );

      const couponResult = await ecommerce.coupons.validateCoupon({
        code: couponCode,
        cartTotal: subtotal,
        productIds,
      });

      if (couponResult.valid) {
        discount = couponResult.discount || 0;
        // Find coupon ID
        const { docs: coupons } = await payload.find({
          collection: 'coupons',
          where: {
            code: {
              equals: couponCode,
            },
          },
          limit: 1,
        });
        if (coupons.length > 0) {
          discountCouponId = coupons[0].id;
        }
      }
    }

    // Calculate other costs (demo values)
    const tax = Math.round((subtotal - discount) * 0.1 * 100) / 100; // 10% tax
    const shipping = subtotal >= 100 ? 0 : 10; // Free shipping over $100
    const total = subtotal - discount + tax + shipping;

    // Create order first (before payment)
    const order = await ecommerce.orders.createOrderFromCart({
      cartId: cart.id,
      orderData: {
        shippingAddress,
        billingAddress,
        paymentMethod: paymentMethod || 'credit_card',
        paymentStatus: 'pending',
        subtotal,
        tax,
        shipping,
        discount,
        total,
        coupon: discountCouponId,
        status: 'pending',
      },
    });

    // Create a payment using the billing plugin (test provider)
    // Amount should be in cents
    const amountInCents = Math.round(total * 100);
    const baseUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
    const returnUrl = `${baseUrl}/orders/${order.id}/confirmation`;

    let payment = null;
    let redirectUrl = null;

    // Try to create payment - requires server restart after adding billing plugin
    try {
      payment = await payload.create({
        collection: 'payments',
        data: {
          provider: 'test',
          // Don't set providerId - let the billing plugin's initPayment hook generate it
          status: 'pending',
          amount: amountInCents,
          currency: 'USD',
          description: `Payment for order ${order.orderNumber}`,
          metadata: {
            orderId: order.id,
            orderNumber: order.orderNumber,
            cartId: cart.id,
            paymentMethod: paymentMethod || 'credit_card',
            returnUrl,
          },
        },
      });

      // Update order with payment ID
      await payload.update({
        collection: 'orders',
        id: order.id,
        data: {
          paymentId: payment.id.toString(),
        },
      });

      // Check if providerId exists
      if (!payment.providerId) {
        throw new Error('Payment created but providerId is missing - billing plugin may not be initialized properly');
      }

      // Redirect to custom test payment page using providerId (not database ID)
      redirectUrl = `/test-payment/${payment.providerId}?returnUrl=${encodeURIComponent(returnUrl)}`;
    } catch (error: any) {
      console.error('[Checkout] Payment creation failed:', error.message);
      // If payment fails, redirect directly to confirmation
      redirectUrl = returnUrl;
    }

    // Clear the cart after order creation
    await payload.delete({
      collection: 'carts',
      where: {
        id: {
          equals: cart.id,
        },
      },
    });

    return NextResponse.json({
      success: true,
      order,
      orderId: order.id,
      orderNumber: order.orderNumber,
      redirectUrl,
      payment: payment ? {
        id: payment.id,
        status: payment.status,
        provider: payment.provider,
      } : null,
    });
  } catch (error: any) {
    console.error('Error creating order:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create order' },
      { status: 500 }
    );
  }
}
