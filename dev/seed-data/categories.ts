export const categoriesSeedData = [
  {
    name: 'Electronics',
    slug: 'electronics',
    description: 'Latest gadgets and electronic devices',
    parent: null
  },
  {
    name: 'Laptops',
    slug: 'laptops',
    description: 'High-performance laptops and notebooks',
    parent: 'electronics'
  },
  {
    name: 'Smartphones',
    slug: 'smartphones',
    description: 'Latest smartphones and mobile devices',
    parent: 'electronics'
  },
  {
    name: 'Accessories',
    slug: 'accessories',
    description: 'Tech accessories and peripherals',
    parent: 'electronics'
  },
  {
    name: 'Clothing',
    slug: 'clothing',
    description: 'Fashionable apparel for all',
    parent: null
  },
  {
    name: 'Men',
    slug: 'men',
    description: "Men's fashion and clothing",
    parent: 'clothing'
  },
  {
    name: 'Women',
    slug: 'women',
    description: "Women's fashion and clothing",
    parent: 'clothing'
  },
  {
    name: 'Home & Garden',
    slug: 'home-garden',
    description: 'Home decor and garden essentials',
    parent: null
  },
  {
    name: 'Furniture',
    slug: 'furniture',
    description: 'Quality furniture for every room',
    parent: 'home-garden'
  },
  {
    name: 'Decor',
    slug: 'decor',
    description: 'Beautiful home decoration items',
    parent: 'home-garden'
  },
];
