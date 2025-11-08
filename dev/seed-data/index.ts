import type { Payload } from 'payload';
import { categoriesSeedData } from './categories';
import { productsSeedData } from './products';
import { couponsSeedData } from './coupons';

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

      // Download and create image if imageUrl is provided
      let imageId;
      if ((product as any).imageUrl) {
        try {
          console.log(`Downloading image for ${product.title}...`);
          const imageResponse = await fetch((product as any).imageUrl);
          const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

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
          console.log(`Created image for ${product.title}`);
        } catch (error) {
          console.error(`Failed to download image for ${product.title}:`, error);
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
          variants: product.variants,
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
