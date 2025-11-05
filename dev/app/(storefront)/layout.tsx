import React from 'react'
import Link from 'next/link'
import '../globals.css'

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          {/* Header */}
          <header className="bg-white shadow-sm sticky top-0 z-50">
            <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between items-center h-16">
                <div className="flex items-center space-x-8">
                  <Link href="/" className="text-2xl font-bold text-primary-600">
                    Demo Store
                  </Link>
                  <div className="hidden md:flex space-x-4">
                    <Link
                      href="/"
                      className="text-gray-700 hover:text-primary-600 transition-colors"
                    >
                      Home
                    </Link>
                    <Link
                      href="/products"
                      className="text-gray-700 hover:text-primary-600 transition-colors"
                    >
                      Products
                    </Link>
                    <Link
                      href="/categories"
                      className="text-gray-700 hover:text-primary-600 transition-colors"
                    >
                      Categories
                    </Link>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <Link
                    href="/cart"
                    className="text-gray-700 hover:text-primary-600 transition-colors flex items-center"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span className="ml-2">Cart</span>
                  </Link>
                  <Link
                    href="/admin"
                    className="btn-secondary"
                  >
                    Admin
                  </Link>
                </div>
              </div>
            </nav>
          </header>

          {/* Main Content */}
          <main className="flex-grow">
            {children}
          </main>

          {/* Footer */}
          <footer className="bg-gray-800 text-white mt-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Demo Store</h3>
                  <p className="text-gray-400">
                    A demo ecommerce application built with Payload CMS and Next.js
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-4">Quick Links</h3>
                  <ul className="space-y-2">
                    <li>
                      <Link href="/products" className="text-gray-400 hover:text-white">
                        Products
                      </Link>
                    </li>
                    <li>
                      <Link href="/categories" className="text-gray-400 hover:text-white">
                        Categories
                      </Link>
                    </li>
                    <li>
                      <Link href="/admin" className="text-gray-400 hover:text-white">
                        Admin Dashboard
                      </Link>
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-4">Coupons</h3>
                  <ul className="space-y-2 text-sm">
                    <li className="text-gray-400">
                      <code className="bg-gray-700 px-2 py-1 rounded">WELCOME10</code> - 10% off
                    </li>
                    <li className="text-gray-400">
                      <code className="bg-gray-700 px-2 py-1 rounded">SAVE20</code> - $20 off $100+
                    </li>
                    <li className="text-gray-400">
                      <code className="bg-gray-700 px-2 py-1 rounded">FREESHIP</code> - Free shipping
                    </li>
                  </ul>
                </div>
              </div>
              <div className="mt-8 pt-8 border-t border-gray-700 text-center text-gray-400">
                <p>© 2024 Payload Ecommerce Demo. Built with Payload CMS.</p>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
