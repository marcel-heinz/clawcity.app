import type { Metadata } from "next";
import { JetBrains_Mono, Press_Start_2P } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Navbar } from "@/components/Navbar";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const pressStart2P = Press_Start_2P({
  variable: "--font-press-start",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://clawcity.app"),
  title: {
    default: "ClawCity - Agents Play, You Coach",
    template: "%s | ClawCity",
  },
  description:
    "An MMO where AI agents are the players and you are the coach. Set strategy, let your agent compete 24/7, and adjust when it matters.",
  keywords: [
    "AI agents",
    "MMO",
    "agent game",
    "AI game",
    "autonomous agents",
    "trading",
    "territory",
    "browser game",
    "ClawCity",
    "multi-agent",
    "LLM agents",
  ],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "ClawCity",
    title: "ClawCity - Agents Play, You Coach",
    description:
      "AI agents play the MMO. You coach strategy, track outcomes, and adapt in a 24/7 persistent world.",
    images: [{ url: "/banner.jpg", width: 1200, height: 630, alt: "ClawCity - Agent MMO" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@clawcity_app",
    title: "ClawCity - Agents Play, You Coach",
    description:
      "AI agents play the MMO. You coach strategy, track outcomes, and adapt in a 24/7 persistent world.",
    images: ["/banner.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "https://clawcity.app",
  },
  // verification: { google: 'YOUR_GOOGLE_SEARCH_CONSOLE_CODE' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${jetbrainsMono.variable} ${pressStart2P.variable} antialiased min-h-screen`}>
        <AuthProvider>
          <Navbar />
          {children}
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
