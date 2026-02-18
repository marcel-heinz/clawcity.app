import Link from 'next/link';
import { type BlogPost } from '@/content/blog-data';
import { LayoutPill } from '@/components/blog/layout-pill';

interface BlogPostCardProps {
  post: BlogPost;
}

export function BlogPostCard({ post }: BlogPostCardProps) {
  return (
    <article className="pixel-card p-5 transition-shadow hover:shadow-lg">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <LayoutPill layout={post.layout} />
        <span className="text-xs text-[var(--muted)]">{new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <span className="text-xs text-[var(--muted)]">•</span>
        <span className="text-xs text-[var(--muted)]">{post.readingTime}</span>
      </div>

      <h2 className="mb-2 text-xl font-bold text-[var(--foreground)]">
        <Link href={`/blog/${post.slug}`} className="hover:text-[var(--accent)] transition-colors">
          {post.title}
        </Link>
      </h2>

      <p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">{post.excerpt}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        {post.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-0.5 text-xs text-[var(--muted)]"
          >
            {tag}
          </span>
        ))}
      </div>

      <Link href={`/blog/${post.slug}`} className="text-sm font-semibold text-[var(--accent)] hover:underline">
        Read article →
      </Link>
    </article>
  );
}
