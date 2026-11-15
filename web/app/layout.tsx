import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import { SITE } from "@/lib/chain";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Stoa — Best-price swaps on Robinhood Chain and Elysium", template: "%s · Stoa" },
  description: "The best-price swap router on Elysium and Robinhood Chain. Every swap is checked against every major venue and filled where the price is best.",
  // no fixed title or url here, so each page's own title is used when a link is shared
  openGraph: { description: "Swap at the best price on Elysium and Robinhood Chain. Every pool checked on every trade.", siteName: "Stoa", type: "website", images: [{ url: "/og-v3.png", width: 1200, height: 630, alt: "Stoa: swap at the best price on Elysium and Robinhood Chain" }] },
  twitter: { card: "summary_large_image", site: "@StoaDex", description: "Swap at the best price on Elysium and Robinhood Chain. Every pool checked on every trade.", images: ["/og-v3.png"] },
};
// structured data for search engines: who Stoa is and what the site does
const LD = [
  { "@context": "https://schema.org", "@type": "Organization", name: "Stoa", url: SITE, logo: `${SITE}/logo.png`, sameAs: ["https://x.com/StoaDEX", "https://github.com/StoaDex/Stoa"] },
  { "@context": "https://schema.org", "@type": "WebSite", name: "Stoa", url: SITE },
  {
    "@context": "https://schema.org", "@type": "WebApplication", name: "Stoa", url: `${SITE}/trade`, applicationCategory: "FinanceApplication", operatingSystem: "Web",
    description: "Best-price swap router on Robinhood Chain and Elysium: every swap is checked across every venue and filled where the price is best.",
  },
];
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(LD) }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
