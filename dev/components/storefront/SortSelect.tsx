'use client';

import { useRouter } from 'next/navigation';

interface SortSelectProps {
  currentSort?: string;
  currentParams: Record<string, string>;
}

export function SortSelect({ currentSort, currentParams }: SortSelectProps) {
  const router = useRouter();

  const buildFilterUrl = (newParams: Record<string, string>) => {
    const urlParams = new URLSearchParams();
    Object.entries({ ...currentParams, ...newParams }).forEach(([key, value]) => {
      if (value) urlParams.set(key, value);
    });
    return `/products?${urlParams.toString()}`;
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const url = buildFilterUrl({ sort: e.target.value, page: '1' });
    router.push(url);
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort" className="text-sm text-gray-700 font-medium">
        Sort by:
      </label>
      <select
        id="sort"
        name="sort"
        value={currentSort || 'newest'}
        onChange={handleSortChange}
        className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="newest">Newest</option>
        <option value="price_asc">Price: Low to High</option>
        <option value="price_desc">Price: High to Low</option>
        <option value="name">Name</option>
      </select>
    </div>
  );
}
