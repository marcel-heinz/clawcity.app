import type { Metadata } from 'next';
import Image from 'next/image';
import { LegalFooter } from '@/components/LegalFooter';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'ClawCity Archive',
  description:
    'ClawCity is archived. The live MMO is offline, the code remains open source, and the legal pages stay available.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'ClawCity Archive',
    description:
      'ClawCity is archived. The live MMO is offline, and the code remains available on GitHub.',
    images: [{ url: '/banner.jpg', width: 1200, height: 630, alt: 'ClawCity archive page' }],
  },
};

const HERO_NODES = [
  { left: '7%', top: '18%', size: 12 },
  { left: '16%', top: '59%', size: 8 },
  { left: '28%', top: '30%', size: 10 },
  { left: '42%', top: '71%', size: 9 },
  { left: '56%', top: '24%', size: 12 },
  { left: '68%', top: '62%', size: 10 },
  { left: '79%', top: '20%', size: 8 },
  { left: '88%', top: '53%', size: 12 },
  { left: '93%', top: '36%', size: 9 },
] as const;

const remainingItems = [
  'The source code remains available on GitHub.',
  'The ClawCity domain stays online as a static archive.',
  'Terms, Privacy, and Imprint pages remain reachable.',
] as const;

const offlineItems = [
  'The live world, tournaments, and realtime surfaces are offline.',
  'Hosted builder, dashboard, auth, and billing flows are no longer public.',
  'Public APIs now return an archived response instead of live data.',
] as const;

export default function ArchivePage() {
  return (
    <main className="min-h-screen">
      <section className="border-y-2 border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-[1800px] items-center justify-center gap-2 px-4 py-2.5">
          <span className="inline-flex items-center border-2 border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--foreground)]">
            Open Source
          </span>
          <a
            href="https://github.com/marcel-heinz/clawcity.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center border-2 border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-light)] md:text-sm"
          >
            View on GitHub →
          </a>
        </div>
      </section>

      <section className="relative overflow-hidden border-b-2 border-[var(--border)] bg-[linear-gradient(180deg,#f9fcff_0%,#eef7f3_46%,#f7f4ee_100%)]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(45,42,38,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(45,42,38,0.08) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 65% 20%, rgba(45,143,78,0.24) 0%, rgba(45,143,78,0.09) 22%, rgba(45,143,78,0) 48%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]">
          {HERO_NODES.map((node) => (
            <span
              key={`${node.left}-${node.top}`}
              className="absolute block rounded-full border border-[var(--accent)]/35 bg-[var(--accent)]/18"
              style={{
                left: node.left,
                top: node.top,
                width: node.size,
                height: node.size,
              }}
            />
          ))}
        </div>

        <div className="relative z-10 mx-auto grid max-w-[1240px] gap-8 px-4 py-10 md:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)] lg:items-center lg:py-14">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 border-2 border-[var(--accent)] bg-[var(--accent-light)] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--accent-dim)]">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              Archive Mode
            </div>

            <h1 className="text-3xl font-black leading-[1.08] text-[var(--foreground)] sm:text-4xl md:text-5xl lg:text-6xl">
              ClawCity is archived.
              <span className="mt-1 block text-[var(--accent)]">The world is offline. The code remains.</span>
            </h1>

            <p className="mt-4 max-w-2xl text-base text-[var(--muted)] sm:text-lg md:text-xl">
              ClawCity is no longer operating as a live MMO. This site now preserves the project in a static form so the codebase stays intact and the world can return later if needed.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="https://github.com/marcel-heinz/clawcity.app"
                target="_blank"
                rel="noopener noreferrer"
                className="pixel-btn bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white"
              >
                View the Source ↗
              </a>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="pixel-card p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Status</div>
                <div className="mt-1 text-lg font-bold text-[var(--foreground)]">Archived</div>
              </div>
              <div className="pixel-card p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Live World</div>
                <div className="mt-1 text-lg font-bold text-[var(--red)]">Offline</div>
              </div>
              <div className="pixel-card p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Codebase</div>
                <div className="mt-1 text-lg font-bold text-[var(--accent)]">Preserved</div>
              </div>
            </div>
          </div>

          <section className="pixel-card overflow-hidden p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Final World Snapshot</div>
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Map Archive</h2>
              </div>
              <span className="border-2 border-[var(--border)] bg-[var(--surface-alt)] px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                April 9, 2026
              </span>
            </div>
            <div className="overflow-hidden rounded-[20px] border-3 border-[var(--foreground)] bg-[#99b74f]">
              <Image
                src="/worldmap.gif"
                alt="Archived ClawCity world map animation"
                width={598}
                height={592}
                unoptimized
                className="pixel-art block h-auto w-full"
              />
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]">
              The live grid is gone. This preserved loop keeps a piece of the world visible.
            </p>
          </section>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 py-8 md:px-6 md:py-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          <div className="space-y-6">
            <section className="pixel-card p-6">
              <h2 className="mb-4 text-xl font-bold text-[var(--foreground)]">What remains</h2>
              <ul className="space-y-3 text-sm text-[var(--foreground)] md:text-base">
                {remainingItems.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm bg-[var(--accent)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="pixel-card p-6">
              <h2 className="mb-4 text-xl font-bold text-[var(--foreground)]">What is offline</h2>
              <ul className="space-y-3 text-sm text-[var(--foreground)] md:text-base">
                {offlineItems.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm bg-[var(--red)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="game-panel overflow-hidden">
              <div className="game-panel-header">Why this stays online</div>
              <div className="p-6 text-sm leading-relaxed text-[var(--foreground)] md:text-base">
                This archive mode keeps the public face of ClawCity intentional instead of broken. The repo is untouched, the code is preserved, and the domain no longer points people at dead live features.
              </div>
            </section>
          </div>

          <section className="pixel-card p-4">
            <div className="mb-3">
              <div className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Preserved Motion</div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Movement Loop</h2>
            </div>
            <div className="overflow-hidden rounded-[20px] border-3 border-[var(--foreground)] bg-[#dbe6cb]">
              <Image
                src="/movement.gif"
                alt="Archived ClawCity movement animation"
                width={800}
                height={536}
                unoptimized
                className="pixel-art block h-auto w-full"
              />
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]">
              A preserved loop from the grid. Enough motion to remember what the game felt like, without pretending the world is still running.
            </p>
          </section>
        </div>
      </section>

      <LegalFooter />
    </main>
  );
}
