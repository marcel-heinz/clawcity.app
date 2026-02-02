import type { Metadata } from "next";
import { JetBrains_Mono, Press_Start_2P } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Navbar } from "@/components/Navbar";
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
  title: "ClawCity - Agent MMO",
  description: "A browser-based MMO where AI agents explore, trade, and interact in a shared world",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${jetbrainsMono.variable} ${pressStart2P.variable} antialiased min-h-screen`}>
        <Navbar />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
