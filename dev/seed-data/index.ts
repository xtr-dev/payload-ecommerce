import type { Payload } from 'payload';
import { categoriesSeedData } from './categories';
import { productsSeedData } from './products';
import { couponsSeedData } from './coupons';
import { createPlaceholderImage } from './placeholderImage';

export async function seedDatabase(payload: Payload) {
  console.log('Starting database seed...');

  try {
    // Clear existing data
    console.log('Clearing existing data...');
    await payload.delete({
      collection: 'coupons',
      where: {},
    });
    await payload.delete({
      collection: 'products',
      where: {},
    });
    await payload.delete({
      collection: 'categories',
      where: {},
    });

    // Create categories first (map slug to ID for parent relationships)
    console.log('Seeding categories...');
    const categoryMap = new Map<string, string>();

    for (const category of categoriesSeedData) {
      const created = await payload.create({
        collection: 'categories',
        data: {
          name: category.name,
          slug: category.slug,
          description: category.description,
        },
      });
      categoryMap.set(category.slug, created.id);
    }

    // Update parent relationships
    for (const category of categoriesSeedData) {
      if (category.parent) {
        const parentId = categoryMap.get(category.parent);
        const categoryId = categoryMap.get(category.slug);
        if (parentId && categoryId) {
          await payload.update({
            collection: 'categories',
            id: categoryId,
            data: {
              parent: parentId,
            },
          });
        }
      }
    }

    console.log(`Created ${categoryMap.size} categories`);

    // Create products
    console.log('Seeding products...');
    let productsCreated = 0;

    for (const product of productsSeedData) {
      const categoryId = categoryMap.get(product.category);

      // Every product gets a picture drawn on the spot (see createPlaceholderImage), so
      // seeding never needs the network. SEED_SKIP_IMAGES=true (set by vitest.config.js)
      // leaves the pictures out: storing and resizing twenty uploads slows every test run
      // down and no test looks at them.
      let imageId;
      if (process.env.SEED_SKIP_IMAGES !== 'true') {
        try {
          const imageBuffer = await createPlaceholderImage(product.title);

          const mediaDoc = await payload.create({
            collection: 'media',
            data: {
              alt: product.title,
            },
            file: {
              data: imageBuffer,
              mimetype: 'image/jpeg',
              name: `${product.slug}.jpg`,
              size: imageBuffer.length,
            },
          });

          imageId = mediaDoc.id;
        } catch (error) {
          console.error(`Failed to create image for ${product.title}:`, error);
        }
      }

      await payload.create({
        collection: 'products',
        data: {
          title: product.title,
          slug: product.slug,
          description: product.description,
          price: product.price,
          compareAtPrice: product.compareAtPrice,
          sku: product.sku,
          categories: categoryId ? [categoryId] : [],
          status: product.status as any,
          inventory: {
            trackQuantity: product.trackQuantity,
            quantity: product.quantity,
            lowStockThreshold: product.lowStockThreshold,
          },
          // The seed data calls a variant's own stock `quantity`; the field is `inventory`.
          variants: product.variants?.map(({ quantity, ...variant }: any) => ({
            ...variant,
            inventory: quantity,
          })),
          images: imageId ? [imageId] : [],
        },
      });
      productsCreated++;
    }

    console.log(`Created ${productsCreated} products`);

    // Create coupons
    console.log('Seeding coupons...');
    let couponsCreated = 0;

    for (const coupon of couponsSeedData) {
      await payload.create({
        collection: 'coupons',
        data: {
          code: coupon.code,
          type: coupon.type as any,
          value: coupon.value,
          description: coupon.description,
          minPurchase: coupon.minPurchase,
          maxDiscount: coupon.maxDiscount,
          status: coupon.status as any,
          usageLimit: coupon.usageLimit,
          usageCount: coupon.usageCount,
          validFrom: coupon.validFrom,
          validUntil: coupon.validUntil,
        },
      });
      couponsCreated++;
    }

    console.log(`Created ${couponsCreated} coupons`);
    console.log('Database seed completed successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
}
