import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import { SITE } from "@/lib/chain";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Stoa — The market, quoted live", template: "%s · Stoa" },
  description: "The best-price swap router on Elysium and Robinhood Chain. Every swap is checked against every major venue and filled where the price is best.",
  // no fixed title or url here, so each page's own title is used when a link is shared
  openGraph: { description: "Swap at the best price across every Elysium DEX. Maker-quoted pools, checked on every swap.", siteName: "Stoa", type: "website", images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "Stoa: swap at the best price across every Elysium DEX" }] },
  twitter: { card: "summary_large_image", site: "@StoaDEX", description: "Swap at the best price across every Elysium DEX. Maker-quoted pools, checked on every swap.", images: ["/og-v2.png"] },
};
export const viewport: Viewport = { themeColor: "#EEF2F6", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Marcellus&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
