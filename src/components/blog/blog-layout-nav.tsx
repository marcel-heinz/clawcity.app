import Link from 'next/link';
import { BLOG_LAYOUTS, type BlogLayout } from '@/content/blog-data';
import { LayoutPill } from '@/components/blog/layout-pill';

interface BlogLayoutNavProps {
  counts: Record<BlogLayout, number>;
  selectedLayout: BlogLayout | 'all';
}

export function BlogLayoutNav({ counts, selectedLayout }: BlogLayoutNavProps) {
  const totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <nav className="mb-8 flex flex-wrap gap-3">
      <Link
        href="/blog"
        className={`inline-flex items-center gap-2 rounded-md border-2 px-3 py-2 text-sm font-medium transition-colors ${
          selectedLayout === 'all'
            ? 'border-[var(--accent)] bg-[var(--surface-alt)] text-[var(--accent)]'
            : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
        }`}
      >
        <span className="text-xs font-semibold uppercase tracking-wide">All</span>
        <span>{totalCount}</span>
      </Link>
      {BLOG_LAYOUTS.map((layout) => (
        <Link
          key={layout}
          href={`/blog?layout=${layout}`}
          className={`inline-flex items-center gap-2 rounded-md border-2 px-3 py-2 text-sm font-medium transition-colors ${
            selectedLayout === layout
              ? 'border-[var(--accent)] bg-[var(--surface-alt)] text-[var(--accent)]'
              : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
          }`}
        >
          <LayoutPill layout={layout} />
          <span>{counts[layout]}</span>
        </Link>
      ))}
    </nav>
  );
}
