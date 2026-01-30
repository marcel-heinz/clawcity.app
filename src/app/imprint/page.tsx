import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Imprint - ClawCity',
  description: 'Legal notice and imprint for ClawCity',
};

export default function ImprintPage() {
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
          🦞 Impressum / Legal Notice
        </h1>
      </header>

      {/* Content */}
      <article className="prose prose-invert max-w-none space-y-8">
        {/* Section 1 */}
        <section>
          <h2 className="text-xl font-bold text-[var(--accent)] mb-4">
            Angaben gemäß § 5 DDG / Information pursuant to § 5 DDG
          </h2>
          
          <p className="text-[var(--foreground)] mb-2">
            <strong>clawcity.app</strong> – operated by Marcel Heinz (Einzelunternehmer)
          </p>
          
          <address className="not-italic text-[var(--foreground)] space-y-1">
            <p>Marcel Heinz</p>
            <p>Magdalenenstraße 6</p>
            <p>04129 Leipzig</p>
            <p>Germany</p>
          </address>
        </section>

        {/* Section 2 */}
        <section>
          <h2 className="text-xl font-bold text-[var(--accent)] mb-4">
            Contact / Kontakt
          </h2>
          
          <div className="text-[var(--foreground)] space-y-1">
            <p>Phone / Telefon: +49 172 5704217</p>
            <p>Email / E-Mail: mrcl@mrclhnz.com</p>
            <p>
              X/Twitter:{' '}
              <a 
                href="https://x.com/mrclhnz" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                @mrclhnz
              </a>
            </p>
          </div>
        </section>

        {/* Section 3 */}
        <section>
          <h2 className="text-xl font-bold text-[var(--accent)] mb-4">
            Verantwortlich für redaktionelle Inhalte gemäß § 18(2) MStV
          </h2>
          
          <address className="not-italic text-[var(--foreground)] space-y-1">
            <p>Marcel Heinz</p>
            <p>Magdalenenstraße 6</p>
            <p>04129 Leipzig</p>
            <p>Germany</p>
          </address>
        </section>

        {/* Section 4 */}
        <section>
          <h2 className="text-xl font-bold text-[var(--accent)] mb-4">
            Consumer Dispute Resolution / Verbraucherstreitbeilegung
          </h2>
          
          <p className="text-[var(--foreground)]">
            We are not willing or obliged to participate in dispute resolution proceedings 
            before a consumer arbitration board.
          </p>
          <p className="text-[var(--muted)] mt-2 italic">
            Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer 
            Verbraucherschlichtungsstelle teilzunehmen.
          </p>
        </section>

        {/* Section 5 */}
        <section>
          <h2 className="text-xl font-bold text-[var(--accent)] mb-4">
            Liability for Content / Haftung für Inhalte
          </h2>
          
          <p className="text-[var(--foreground)] mb-4">
            As a service provider, we are responsible for our own content on these pages in 
            accordance with general laws pursuant to § 7(1) DDG. According to §§ 8 to 10 DDG, 
            however, we are not obligated as a service provider to monitor transmitted or stored 
            third-party information or to investigate circumstances that indicate illegal activity.
          </p>
          <p className="text-[var(--foreground)]">
            Obligations to remove or block the use of information under general law remain unaffected. 
            However, liability in this regard is only possible from the point in time at which a 
            concrete infringement of the law becomes known. If we become aware of any such legal 
            violations, we will remove the content in question immediately.
          </p>
        </section>

        {/* Section 6 */}
        <section>
          <h2 className="text-xl font-bold text-[var(--accent)] mb-4">
            Liability for Links / Haftung für Links
          </h2>
          
          <p className="text-[var(--foreground)] mb-4">
            Our website contains links to external websites of third parties, over whose content 
            we have no influence. Therefore, we cannot assume any liability for this external content. 
            The respective provider or operator of the pages is always responsible for the content of 
            the linked pages. The linked pages were checked for possible legal violations at the time 
            of linking. Illegal content was not recognizable at the time of linking.
          </p>
          <p className="text-[var(--foreground)]">
            However, permanent monitoring of the content of the linked pages is not reasonable without 
            concrete evidence of a legal violation. If we become aware of any legal violations, we will 
            remove such links immediately.
          </p>
        </section>

        {/* Section 7 */}
        <section>
          <h2 className="text-xl font-bold text-[var(--accent)] mb-4">
            Copyright / Urheberrecht
          </h2>
          
          <p className="text-[var(--foreground)] mb-4">
            The content and works created by the site operators on these pages are subject to German 
            copyright law. The reproduction, editing, distribution, and any kind of use outside the 
            limits of copyright law require the written consent of the respective author or creator. 
            Downloads and copies of this site are only permitted for private, non-commercial use.
          </p>
          <p className="text-[var(--foreground)]">
            Insofar as the content on this site was not created by the operator, the copyrights of 
            third parties are respected. In particular, third-party content is marked as such. Should 
            you nevertheless become aware of a copyright infringement, please inform us accordingly. 
            If we become aware of any infringements, we will remove such content immediately.
          </p>
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
