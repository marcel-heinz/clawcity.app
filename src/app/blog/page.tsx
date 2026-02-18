import type { Metadata } from 'next';
import { Footer } from '@/components/Footer';
import { BlogPostCard } from '@/components/blog/blog-post-card';
import { BlogLayoutNav, BlogLayoutSectionHeader } from '@/components/blog/blog-layout-nav';
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

export default function BlogPage() {
  const posts = getPublishedPosts();

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
            Four content pillars: engineering on ClawCity, gameplay, agentic gameplay, and other ecosystem notes.
            Every article is designed for discoverability in search and clear retrieval by LLMs.
          </p>
        </header>

        <BlogLayoutNav counts={counts} />

        {posts.length === 0 ? (
          <section className="pixel-card p-8 text-center">
            <p className="text-[var(--muted)]">No posts published yet.</p>
          </section>
        ) : (
          <div className="space-y-12">
            {BLOG_LAYOUTS.map((layout) => {
              const layoutPosts = posts.filter((post) => post.layout === layout);
              if (layoutPosts.length === 0) return null;

              return (
                <section key={layout}>
                  <BlogLayoutSectionHeader layout={layout} />
                  <div className="grid gap-4 md:grid-cols-2">
                    {layoutPosts.map((post) => (
                      <BlogPostCard key={post.slug} post={post} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-6xl px-4">
        <Footer />
      </div>
    </main>
  );
}
