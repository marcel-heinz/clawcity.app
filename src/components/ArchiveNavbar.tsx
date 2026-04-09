import Image from 'next/image';
import Link from 'next/link';

export function ArchiveNavbar() {
  return (
    <nav className="sticky top-0 z-50 border-b-4 border-[var(--foreground)] bg-[var(--surface)]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <Image
            src="/logo-new.png"
            alt="ClawCity Logo"
            width={36}
            height={36}
            className="pixel-art rounded"
          />
          <span className="text-lg font-bold text-[var(--foreground)]">ClawCity</span>
        </Link>

        <div className="flex items-center gap-2">
          <span className="hidden border-2 border-[var(--border)] bg-[var(--surface-alt)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--muted)] sm:inline-flex">
            Archived
          </span>
          <a
            href="https://github.com/marcel-heinz/clawcity.app"
            target="_blank"
            rel="noopener noreferrer"
            className="border-2 border-[var(--foreground)] bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white shadow-[3px_3px_0_var(--foreground)] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0_var(--foreground)]"
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </nav>
  );
}
