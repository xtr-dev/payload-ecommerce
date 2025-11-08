import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import configPromise from '@payload-config';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const payload = await getPayload({ config: configPromise });

    // Find payment by providerId
    const { docs: payments } = await payload.find({
      collection: 'payments',
      where: {
        providerId: {
          equals: id,
        },
      },
      limit: 1,
    });

    if (payments.length === 0) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      );
    }

    const payment = payments[0];

    return NextResponse.json({
      id: payment.providerId,
      amount: payment.amount,
      currency: payment.currency,
      description: payment.description,
      metadata: payment.metadata,
    });
  } catch (error: any) {
    console.error('Error fetching payment:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch payment' },
      { status: 500 }
    );
  }
}
