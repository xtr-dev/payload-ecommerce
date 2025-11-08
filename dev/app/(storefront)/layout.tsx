import React from 'react';
import { cookies } from 'next/headers';
import { getPayload } from 'payload';
import configPromise from '@payload-config';
import { Navigation } from '../../components/storefront/Navigation';
import { Footer } from '../../components/storefront/Footer';
import '../../styles/storefront.css';

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const payload = await getPayload({ config: configPromise });

  // Get session ID from cookies or use default demo session
  const sessionId = 'demo-session';

  // Fetch cart for this session
  let cartItemCount = 0;
  try {
    const { docs: carts } = await payload.find({
      collection: 'carts',
      where: {
        sessionId: {
          equals: sessionId,
        },
      },
      limit: 1,
    });

    if (carts.length > 0) {
      const cart = carts[0];
      // Calculate total number of items in cart
      cartItemCount = (cart.items || []).reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);
    }
  } catch (error) {
    console.error('Error fetching cart:', error);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation cartItemCount={cartItemCount} />
      <main className="flex-grow">{children}</main>
      <Footer />
    </div>
  );
}
