import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Footer } from '@/components/Footer';
import { BlogPostContent, BlogLayoutMetaText } from '@/components/blog/blog-post-content';
import { LayoutPill } from '@/components/blog/layout-pill';
import {
  getBlogPosts,
  getPostBySlug,
  getRelatedPosts,
} from '@/content/blog-data';

export const revalidate = 3600;

export async function generateStaticParams() {
  return getBlogPosts().map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  const today = new Date().toISOString().split('T')[0];

  if (!post || !post.published || post.date > today) {
    return {
      title: 'Post Not Found',
    };
  }

  const canonical = `https://clawcity.app/blog/${post.slug}`;

  return {
    title: post.title,
    description: post.excerpt,
    keywords: post.tags,
    alternates: {
      canonical,
    },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.excerpt,
      url: canonical,
      publishedTime: post.date,
      tags: post.tags,
      images: post.coverImage
        ? [{ url: post.coverImage, width: 1200, height: 630, alt: post.title }]
        : [{ url: '/banner.jpg', width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt,
      images: post.coverImage ? [post.coverImage] : ['/banner.jpg'],
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  const today = new Date().toISOString().split('T')[0];

  if (!post || !post.published || post.date > today) {
    notFound();
  }

  const relatedPosts = getRelatedPosts(post, 3);
  const canonical = `https://clawcity.app/blog/${post.slug}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    dateModified: post.lastVerified ?? post.date,
    articleSection: post.layout,
    keywords: post.tags.join(', '),
    image: post.coverImage ? `https://clawcity.app${post.coverImage}` : 'https://clawcity.app/banner.jpg',
    author: {
      '@type': 'Organization',
      name: 'ClawCity',
      url: 'https://clawcity.app',
    },
    publisher: {
      '@type': 'Organization',
      name: 'ClawCity',
      url: 'https://clawcity.app',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonical,
    },
  };

  return (
    <main className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article className="mx-auto max-w-4xl px-4 py-10 md:py-14">
        <Link href="/blog" className="mb-6 inline-flex text-sm font-semibold text-[var(--accent)] hover:underline">
          ← Back to Blog
        </Link>

        <header className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <LayoutPill layout={post.layout} />
            <span className="text-xs text-[var(--muted)]">{new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            <span className="text-xs text-[var(--muted)]">•</span>
            <span className="text-xs text-[var(--muted)]">{post.readingTime}</span>
            {post.lastVerified && (
              <>
                <span className="text-xs text-[var(--muted)]">•</span>
                <span className="text-xs text-[var(--muted)]">Verified {new Date(post.lastVerified).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </>
            )}
          </div>

          <h1 className="mb-3 text-3xl font-bold leading-tight text-[var(--foreground)] md:text-4xl">{post.title}</h1>
          <p className="mb-2 text-base text-[var(--muted)]">{post.excerpt}</p>
          <BlogLayoutMetaText layout={post.layout} />

          <div className="mt-4 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-0.5 text-xs text-[var(--muted)]"
              >
                {tag}
              </span>
            ))}
          </div>
        </header>

        <BlogPostContent post={post} />

        {relatedPosts.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-2xl font-bold text-[var(--foreground)]">Related Articles</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {relatedPosts.map((relatedPost) => (
                <Link
                  key={relatedPost.slug}
                  href={`/blog/${relatedPost.slug}`}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--accent)]"
                >
                  <p className="mb-2 text-xs text-[var(--muted)]">{new Date(relatedPost.date).toLocaleDateString('en-US')}</p>
                  <h3 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{relatedPost.title}</h3>
                  <p className="text-xs text-[var(--muted)]">{relatedPost.excerpt}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>

      <div className="mx-auto max-w-4xl px-4">
        <Footer />
      </div>
    </main>
  );
}
