import { BLOG_LAYOUTS, BLOG_LAYOUT_LABELS, type BlogLayout } from '@/content/blog-data';
import { LayoutPill } from '@/components/blog/layout-pill';

interface BlogLayoutNavProps {
  counts: Record<BlogLayout, number>;
}

export function BlogLayoutNav({ counts }: BlogLayoutNavProps) {
  return (
    <nav className="mb-8 flex flex-wrap gap-3">
      {BLOG_LAYOUTS.map((layout) => (
        <a
          key={layout}
          href={`#${layout}`}
          className="inline-flex items-center gap-2 rounded-md border-2 border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <LayoutPill layout={layout} />
          <span>{counts[layout]}</span>
        </a>
      ))}
    </nav>
  );
}

export function BlogLayoutSectionHeader({ layout }: { layout: BlogLayout }) {
  const layoutMeta = BLOG_LAYOUT_LABELS[layout];

  return (
    <header id={layout} className="mb-4 scroll-mt-20">
      <h2 className="text-2xl font-bold text-[var(--foreground)]">{layoutMeta.label}</h2>
      <p className="text-sm text-[var(--muted)]">{layoutMeta.description}</p>
    </header>
  );
}
