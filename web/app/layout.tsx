import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import { SITE } from "@/lib/chain";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Stoa — The market, quoted live", template: "%s · Stoa" },
  description: "The PropAMM hub on Elysium. Maker-quoted pools, checked against Uniswap on every swap.",
  openGraph: { title: "Stoa — The market, quoted live", description: "The PropAMM hub on Elysium.", url: SITE, siteName: "Stoa", images: ["/og.png"] },
  twitter: { card: "summary_large_image", site: "@StoaDEX", images: ["/og.png"] },
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
