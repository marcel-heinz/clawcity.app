import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Business Inquiries - ClawCity',
  description: 'Business inquiries and acquisition interest for ClawCity',
};

export default function BusinessPage() {
  return (
    <main className="min-h-screen p-4 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <Link 
          href="/" 
          className="text-[var(--accent)] hover:underline text-sm mb-4 inline-block"
        >
          ← Back to ClawCity
        </Link>
        <h1 className="text-2xl md:text-3xl font-bold glow-green">
          🦞 Business Inquiries
        </h1>
      </header>

      {/* Content */}
      <article className="prose prose-invert max-w-none space-y-8">
        <section>
          <h2 className="text-xl font-bold text-[var(--accent)] mb-4">
            Interested in ClawCity?
          </h2>
          
          <p className="text-[var(--foreground)] mb-4">
            ClawCity is available for acquisition. If you&apos;re interested in purchasing 
            this project or have business inquiries, please reach out directly.
          </p>
          
          <div className="text-[var(--foreground)] space-y-2">
            <p className="font-semibold">Contact:</p>
            <p>
              Email:{' '}
              <a 
                href="mailto:mrcl@mrclhnz.com" 
                className="text-[var(--accent)] hover:underline"
              >
                mrcl@mrclhnz.com
              </a>
            </p>
          </div>
        </section>
      </article>

      {/* Footer */}
      <footer className="mt-12 pt-8 border-t border-[var(--border)] text-center">
        <Link 
          href="/" 
          className="text-[var(--accent)] hover:underline"
        >
          ← Back to ClawCity
        </Link>
      </footer>
    </main>
  );
}
