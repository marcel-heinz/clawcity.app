import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type BlogLayout, type BlogPost, BLOG_LAYOUT_LABELS } from '@/content/blog-data';

type MarkdownNodeProps = { node?: unknown };

function stripNode<T extends MarkdownNodeProps>(props: T): Omit<T, 'node'> {
  const { node, ...rest } = props;
  void node;
  return rest;
}

const markdownComponents: Components = {
  h2: (props) => (
    <h2 className="mt-8 mb-3 text-2xl font-bold text-[var(--foreground)]" {...stripNode(props)} />
  ),
  h3: (props) => (
    <h3 className="mt-6 mb-2 text-xl font-semibold text-[var(--foreground)]" {...stripNode(props)} />
  ),
  p: (props) => (
    <p className="mb-4 leading-relaxed text-[var(--foreground)]" {...stripNode(props)} />
  ),
  ul: (props) => <ul className="mb-4 list-disc space-y-2 pl-6" {...stripNode(props)} />,
  ol: (props) => <ol className="mb-4 list-decimal space-y-2 pl-6" {...stripNode(props)} />,
  li: (props) => <li className="text-[var(--foreground)]" {...stripNode(props)} />,
  a: (props) => (
    <a className="font-semibold text-[var(--accent)] underline-offset-2 hover:underline" {...stripNode(props)} />
  ),
  blockquote: (props) => (
    <blockquote className="my-5 border-l-4 border-[var(--accent)] bg-[var(--surface-alt)] px-4 py-3" {...stripNode(props)} />
  ),
  table: (props) => (
    <div className="my-6 overflow-x-auto">
      <table className="min-w-full border-2 border-[var(--border)] text-sm" {...stripNode(props)} />
    </div>
  ),
  th: (props) => (
    <th className="border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-left" {...stripNode(props)} />
  ),
  td: (props) => <td className="border border-[var(--border)] px-3 py-2" {...stripNode(props)} />,
  code: (props) => {
    const { className, ...rest } = stripNode(props);
    const isInline = !className;
    if (isInline) {
      return <code className="rounded bg-[var(--surface-alt)] px-1.5 py-0.5 text-sm" {...rest} />;
    }
    return <code className={`block overflow-x-auto rounded bg-[var(--surface-alt)] p-3 text-sm ${className ?? ''}`} {...rest} />;
  },
};

function LayoutFrame({ layout }: { layout: BlogLayout }) {
  if (layout === 'engineering-on-clawcity') {
    return (
      <section className="pixel-card mb-8 p-5">
        <h2 className="mb-2 text-lg font-bold text-[var(--foreground)]">Engineering Frame</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">Focus on constraints, implementation choices, and measurable outcomes.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--foreground)]">
          <li>Document system boundaries and tradeoffs.</li>
          <li>Reference concrete endpoints, files, or migration steps.</li>
          <li>Include impact metrics where available.</li>
        </ul>
      </section>
    );
  }

  if (layout === 'gameplay') {
    return (
      <section className="pixel-card mb-8 border-[var(--gold)] p-5">
        <h2 className="mb-2 text-lg font-bold text-[var(--foreground)]">Gameplay Frame</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">Actionable guide for players optimizing outcomes in live cycles.</p>
        <div className="flex flex-wrap gap-2 text-sm font-medium">
          <Link href="/tournament" className="rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)]">
            Tournament
          </Link>
          <Link href="/agent-search" className="rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)]">
            Agent Search
          </Link>
        </div>
      </section>
    );
  }

  if (layout === 'agentic-gameplay') {
    return (
      <section className="pixel-card mb-8 border-[var(--accent)] p-5">
        <h2 className="mb-2 text-lg font-bold text-[var(--foreground)]">Agentic Frame</h2>
        <p className="mb-3 text-sm text-[var(--muted)]">Operational guidance for autonomous agents and orchestration loops.</p>
        <div className="flex flex-wrap gap-2 text-sm font-medium">
          <Link href="/skill.md" className="rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)]">
            skill.md
          </Link>
          <Link href="/llms-full.txt" className="rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)]">
            llms-full.txt
          </Link>
          <Link href="/about/for-developers" className="rounded border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 hover:border-[var(--accent)] hover:text-[var(--accent)]">
            Developer Guide
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="pixel-card mb-8 p-5">
      <h2 className="mb-2 text-lg font-bold text-[var(--foreground)]">Context Frame</h2>
      <p className="text-sm text-[var(--muted)]">
        Editorial and ecosystem updates related to ClawCity, with practical implications for operators and players.
      </p>
    </section>
  );
}

export function BlogPostContent({ post }: { post: BlogPost }) {
  return (
    <div>
      <LayoutFrame layout={post.layout} />
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {post.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export function BlogLayoutMetaText({ layout }: { layout: BlogLayout }) {
  return <p className="text-sm text-[var(--muted)]">{BLOG_LAYOUT_LABELS[layout].description}</p>;
}
