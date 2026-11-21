import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import SiteAnalytics from "@/components/SiteAnalytics";
import MiniAppBridge from "@/components/MiniAppBridge";
import { SITE } from "@/lib/chain";
import { Inter, JetBrains_Mono, Marcellus } from "next/font/google";
import "./globals.css";
import { ldJson } from "@/lib/ldJson";

// self-hosted at build time (no request to Google, nothing render-blocking); globals.css reads the variables
const serif = Marcellus({ subsets: ["latin"], weight: "400", display: "swap", variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--font-mono" });

const FC_EMBED = JSON.stringify({
  version: "1", imageUrl: `${SITE}/fc-embed.png`,
  button: { title: "Open Stoa", action: { type: "launch_miniapp", name: "Stoa", splashImageUrl: `${SITE}/fc-splash.png`, splashBackgroundColor: "#EEF2F8" } },
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Stoa — Every route, compared. Swaps on Robinhood Chain and Elysium", template: "%s · Stoa" },
  description: "A swap router on Robinhood Chain and Elysium. Every swap is compared across every venue the router uses, for your exact amount, and filled on the one that pays the most.",
  // no fixed title or url here, so each page's own title is used when a link is shared
  openGraph: { description: "Swap on Robinhood Chain and Elysium. Every venue the router uses, compared on every swap.", siteName: "Stoa", type: "website", images: [{ url: "/og-v5.png", width: 1200, height: 630, alt: "Stoa: every route, compared. Swaps on Robinhood Chain and Elysium" }] },
  twitter: { card: "summary_large_image", site: "@StoaDex", description: "Swap on Robinhood Chain and Elysium. Every venue the router uses, compared on every swap.", images: ["/og-v5.png"] },
  // installed as an app (manifest.ts): name and status bar on iPhone home screens
  appleWebApp: { capable: true, title: "Stoa", statusBarStyle: "default" },
  // Google Search Console ownership (URL-prefix property https://stoadex.com)
  verification: { google: "AP_Tt9q0yq2k5u87TR5_9tr2uUQclr70RT9jfRFjVLA" },
  // shared in a Farcaster client, a stoadex.com link shows this card with a button that opens that page as a Mini App
  other: { "fc:miniapp": FC_EMBED, "fc:frame": FC_EMBED.replace('"launch_miniapp"', '"launch_frame"') },
};
// structured data for search engines: who Stoa is and what the site does
const LD = [
  { "@context": "https://schema.org", "@type": "Organization", name: "Stoa", url: SITE, logo: `${SITE}/logo.png`, sameAs: ["https://x.com/StoaDEX", "https://t.me/StoaDex", "https://t.me/StoaDexChat", "https://github.com/StoaDex/Stoa"] },
  { "@context": "https://schema.org", "@type": "WebSite", name: "Stoa", url: SITE },
  {
    "@context": "https://schema.org", "@type": "WebApplication", name: "Stoa", url: `${SITE}/trade`, applicationCategory: "FinanceApplication", operatingSystem: "Web",
    description: "Swap router on Robinhood Chain and Elysium: every swap is compared across every venue the router uses and filled on the one that pays the most.",
  },
];
export const viewport: Viewport = { themeColor: "#EEF2F6", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      {/* the footer's HEY Research Lab badge is the largest picture on short pages: open its connection early */}
      <head><link rel="preconnect" href="https://heyresearch.xyz" /></head>
      <body>
        {/* opened as a Telegram Mini App: tell Telegram the page is ready and use the full height */}
        <script dangerouslySetInnerHTML={{ __html: "try{var p=window.TelegramWebviewProxy;if(p){p.postEvent('web_app_ready','{}');p.postEvent('web_app_expand','{}')}}catch(e){}" }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(LD) }} />
        <Providers>{children}</Providers>
        <SiteAnalytics />
        <MiniAppBridge />
      </body>
    </html>
  );
}
