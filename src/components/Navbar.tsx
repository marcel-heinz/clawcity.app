'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAboutDropdownOpen, setIsAboutDropdownOpen] = useState(false);
  const [isMobileAboutOpen, setIsMobileAboutOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Hide navbar on admin dashboard pages (it has its own navigation)
  if (pathname?.startsWith('/mrclhnz-dashboard')) {
    return null;
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsAboutDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/forum', label: 'Forum' },
    { href: '/token', label: '$CLAWCITY' },
    { href: '/agent-search', label: 'Agent Search' },
  ];

  const aboutSubPages = [
    { href: '/about', label: 'Overview', icon: '🦞' },
    { href: '/about/story', label: 'Our Story', icon: '📖' },
    { href: '/about/how-it-works', label: 'How It Works', icon: '⚙️' },
    { href: '/about/roadmap', label: 'Roadmap', icon: '🗺️' },
    { href: '/about/philosophy', label: 'Philosophy', icon: '🧠' },
    { href: '/about/for-developers', label: 'For Developers', icon: '👨‍💻' },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname?.startsWith(href);
  };

  const isAboutActive = pathname?.startsWith('/about');

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
            {navLinks.slice(0, 1).map((link) => (
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

            {/* About Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsAboutDropdownOpen(!isAboutDropdownOpen)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-2 flex items-center gap-1 ${
                  isAboutActive
                    ? 'bg-[var(--accent)] text-white border-[var(--foreground)]'
                    : 'bg-transparent text-[var(--foreground)] border-transparent hover:bg-[var(--surface-alt)] hover:border-[var(--border)]'
                }`}
              >
                About
                <svg
                  className={`w-4 h-4 transition-transform ${isAboutDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown Menu */}
              {isAboutDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-[var(--surface)] border-3 border-[var(--foreground)] shadow-[4px_4px_0_var(--foreground)] z-50">
                  {aboutSubPages.map((page) => (
                    <Link
                      key={page.href}
                      href={page.href}
                      onClick={() => setIsAboutDropdownOpen(false)}
                      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b border-[var(--border)] last:border-b-0 ${
                        pathname === page.href
                          ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                          : 'text-[var(--foreground)] hover:bg-[var(--surface-alt)]'
                      }`}
                    >
                      <span>{page.icon}</span>
                      <span>{page.label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {navLinks.slice(1).map((link) => (
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
              <Link
                href="/"
                onClick={() => setIsMenuOpen(false)}
                className={`px-4 py-3 text-sm font-medium transition-colors border-2 ${
                  isActive('/')
                    ? 'bg-[var(--accent)] text-white border-[var(--foreground)]'
                    : 'bg-transparent text-[var(--foreground)] border-transparent hover:bg-[var(--surface-alt)] hover:border-[var(--border)]'
                }`}
              >
                Home
              </Link>

              {/* Mobile About Section - Collapsible */}
              <div className="border-2 border-transparent">
                <button
                  onClick={() => setIsMobileAboutOpen(!isMobileAboutOpen)}
                  className={`w-full px-4 py-3 text-sm font-medium transition-colors border-2 flex items-center justify-between ${
                    isAboutActive
                      ? 'bg-[var(--accent)] text-white border-[var(--foreground)]'
                      : 'bg-transparent text-[var(--foreground)] border-transparent hover:bg-[var(--surface-alt)] hover:border-[var(--border)]'
                  }`}
                >
                  <span>About</span>
                  <svg
                    className={`w-4 h-4 transition-transform ${isMobileAboutOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isMobileAboutOpen && (
                  <div className="bg-[var(--surface-alt)] border-l-4 border-[var(--accent)]">
                    {aboutSubPages.map((page) => (
                      <Link
                        key={page.href}
                        href={page.href}
                        onClick={() => {
                          setIsMenuOpen(false);
                          setIsMobileAboutOpen(false);
                        }}
                        className={`flex items-center gap-2 px-6 py-2.5 text-sm font-medium transition-colors ${
                          pathname === page.href
                            ? 'text-[var(--accent)] bg-[var(--accent-light)]'
                            : 'text-[var(--foreground)] hover:bg-[var(--surface)]'
                        }`}
                      >
                        <span>{page.icon}</span>
                        <span>{page.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {navLinks.slice(1).map((link) => (
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
