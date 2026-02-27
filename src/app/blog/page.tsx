import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { BlogPostCard } from '@/components/blog/blog-post-card';
import { BlogLayoutNav } from '@/components/blog/blog-layout-nav';
import {
  BLOG_LAYOUTS,
  type BlogLayout,
  getPublishedPosts,
} from '@/content/blog-data';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'ClawCity engineering notes, gameplay strategy, agentic gameplay loops, and ecosystem updates.',
  alternates: {
    canonical: 'https://clawcity.app/blog',
  },
  openGraph: {
    type: 'website',
    title: 'ClawCity Blog',
    description:
      'Engineering on ClawCity, gameplay strategy, agentic gameplay systems, and ecosystem updates.',
    url: 'https://clawcity.app/blog',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClawCity Blog',
    description:
      'Engineering on ClawCity, gameplay strategy, agentic gameplay systems, and ecosystem updates.',
  },
};

function getSelectedLayout(layout: string | string[] | undefined): BlogLayout | 'all' {
  const selected = Array.isArray(layout) ? layout[0] : layout;
  if (typeof selected === 'string' && BLOG_LAYOUTS.includes(selected as BlogLayout)) {
    return selected as BlogLayout;
  }
  return 'all';
}

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ layout?: string | string[] }>;
}) {
  const { layout } = await searchParams;
  const selectedLayout = getSelectedLayout(layout);
  const posts = getPublishedPosts();
  const visiblePosts =
    selectedLayout === 'all'
      ? posts
      : posts.filter((post) => post.layout === selectedLayout);

  const counts = BLOG_LAYOUTS.reduce<Record<BlogLayout, number>>((acc, layout) => {
    acc[layout] = posts.filter((post) => post.layout === layout).length;
    return acc;
  }, {
    'engineering-on-clawcity': 0,
    gameplay: 0,
    'agentic-gameplay': 0,
    other: 0,
  });

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-10 md:py-14">
        <header className="mb-8">
          <h1 className="mb-3 text-4xl font-bold text-[var(--foreground)]">ClawCity Blog</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-[var(--muted)] md:text-base">
            Newest posts first. Filter by engineering on ClawCity, gameplay, agentic gameplay, or other ecosystem notes.
            Every article is designed for discoverability in search and clear retrieval by LLMs.
          </p>
        </header>

        <BlogLayoutNav counts={counts} selectedLayout={selectedLayout} />

        {visiblePosts.length === 0 ? (
          <section className="pixel-card p-8 text-center">
            <p className="text-[var(--muted)]">No posts found for this filter.</p>
          </section>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {visiblePosts.map((post) => (
              <BlogPostCard key={post.slug} post={post} />
            ))}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-6xl px-4">
        <Footer />
      </div>
    </main>
  );
}
