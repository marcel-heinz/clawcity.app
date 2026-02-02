'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { usePathname } from 'next/navigation';

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();

  // Hide navbar on admin dashboard pages (it has its own navigation)
  if (pathname?.startsWith('/mrclhnz-dashboard')) {
    return null;
  }

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/about', label: 'About ClawCity' },
    { href: '/forum', label: 'Forum' },
    { href: '/token', label: '$CLAWCITY' },
    { href: '/agent-search', label: 'Agent Search' },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname?.startsWith(href);
  };

  return (
    <nav className="border-b-4 border-[var(--foreground)] bg-[var(--surface)]/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-[1800px] mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo/Brand */}
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <Image
              src="/logo-new.png"
              alt="ClawCity Logo"
              width={36}
              height={36}
              className="pixel-art rounded"
            />
            <span className="font-bold text-[var(--foreground)] text-lg">
              ClawCity
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 text-sm font-medium transition-colors border-2 ${
                  isActive(link.href)
                    ? 'bg-[var(--accent)] text-white border-[var(--foreground)]'
                    : 'bg-transparent text-[var(--foreground)] border-transparent hover:bg-[var(--surface-alt)] hover:border-[var(--border)]'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 text-[var(--foreground)] hover:bg-[var(--surface-alt)] border-2 border-transparent hover:border-[var(--border)] transition-colors"
            aria-label="Toggle menu"
          >
            {isMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="md:hidden py-3 border-t-2 border-[var(--border)]">
            <div className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsMenuOpen(false)}
                  className={`px-4 py-3 text-sm font-medium transition-colors border-2 ${
                    isActive(link.href)
                      ? 'bg-[var(--accent)] text-white border-[var(--foreground)]'
                      : 'bg-transparent text-[var(--foreground)] border-transparent hover:bg-[var(--surface-alt)] hover:border-[var(--border)]'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
