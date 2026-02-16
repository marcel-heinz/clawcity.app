'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAboutDropdownOpen, setIsAboutDropdownOpen] = useState(false);
  const [isMobileAboutOpen, setIsMobileAboutOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const { user, loading, signOut } = useAuth();

  // Hide navbar on admin dashboard pages (it has its own navigation)
  const rawAdminPath = process.env.NEXT_PUBLIC_ADMIN_PATH || '/mrclhnz-dashboard';
  const adminPath = rawAdminPath.startsWith('/') ? rawAdminPath : `/${rawAdminPath}`;
  const isAdminPage = pathname?.startsWith(adminPath);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsAboutDropdownOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [user?.user_metadata?.avatar_url]);

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/forum', label: 'Forum' },
    { href: '/tournament', label: 'Tournament' },
    { href: '/open-worlds', label: 'Open Worlds' },
    { href: '/agent-search', label: 'Agent Search' },
  ];

  const aboutSubPages = [
    { href: '/about', label: 'Overview', icon: '🦞' },
    { href: '/about/story', label: 'Our Story', icon: '📖' },
    { href: '/about/how-it-works', label: 'How It Works', icon: '⚙️' },
    { href: '/about/roadmap', label: 'Roadmap', icon: '🗺️' },
    { href: '/about/philosophy', label: 'Philosophy', icon: '🧠' },
    { href: '/about/for-developers', label: 'For Developers', icon: '👨‍💻' },
    { href: '/about/faq', label: 'FAQ', icon: '❓' },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname?.startsWith(href);
  };

  const isAboutActive = pathname?.startsWith('/about');

  if (isAdminPage) {
    return null;
  }

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

            {/* Auth: Sign In or User Menu */}
            {!loading && (
              user ? (
                <div className="relative ml-2" ref={userMenuRef}>
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-2 px-3 py-1.5 border-2 border-transparent hover:border-[var(--border)] hover:bg-[var(--surface-alt)] transition-colors"
                  >
                    {user.user_metadata?.avatar_url && !avatarLoadFailed ? (
                      <Image
                        src={user.user_metadata.avatar_url}
                        alt=""
                        width={24}
                        height={24}
                        className="rounded-full"
                        onError={() => setAvatarLoadFailed(true)}
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold">
                        {(user.email?.[0] || '?').toUpperCase()}
                      </div>
                    )}
                    <svg
                      className={`w-3 h-3 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isUserMenuOpen && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-[var(--surface)] border-3 border-[var(--foreground)] shadow-[4px_4px_0_var(--foreground)] z-50">
                      <div className="px-4 py-2 border-b border-[var(--border)] text-xs text-[var(--muted)] truncate">
                        {user.email}
                      </div>
                      <Link
                        href="/builder"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="block px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface-alt)] text-[var(--foreground)]"
                      >
                        Agent Builder
                      </Link>
                      <Link
                        href="/dashboard"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="block px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface-alt)] text-[var(--foreground)]"
                      >
                        Dashboard
                      </Link>
                      <Link
                        href="/pricing"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="block px-4 py-2.5 text-sm font-medium hover:bg-[var(--surface-alt)] text-[var(--foreground)] border-b border-[var(--border)]"
                      >
                        Pricing
                      </Link>
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          signOut();
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-[var(--red-light)] text-[var(--red)]"
                      >
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  href="/auth/login"
                  className="ml-2 px-4 py-2 text-sm font-semibold bg-[var(--accent)] text-white border-2 border-[var(--foreground)] shadow-[3px_3px_0_var(--foreground)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_var(--foreground)] transition-all"
                >
                  Sign In
                </Link>
              )
            )}
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

              {/* Mobile Auth */}
              <div className="mt-2 pt-2 border-t-2 border-[var(--border)]">
                {!loading && (
                  user ? (
                    <>
                      <Link
                        href="/builder"
                        onClick={() => setIsMenuOpen(false)}
                        className="block px-4 py-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
                      >
                        Agent Builder
                      </Link>
                      <Link
                        href="/dashboard"
                        onClick={() => setIsMenuOpen(false)}
                        className="block px-4 py-3 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-alt)]"
                      >
                        Dashboard
                      </Link>
                      <button
                        onClick={() => {
                          setIsMenuOpen(false);
                          signOut();
                        }}
                        className="w-full text-left px-4 py-3 text-sm font-medium text-[var(--red)] hover:bg-[var(--red-light)]"
                      >
                        Sign Out ({user.email})
                      </button>
                    </>
                  ) : (
                    <Link
                      href="/auth/login"
                      onClick={() => setIsMenuOpen(false)}
                      className="block px-4 py-3 text-sm font-semibold text-[var(--accent)]"
                    >
                      Sign In
                    </Link>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
