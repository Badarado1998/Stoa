"use client";
import { Analytics } from "@vercel/analytics/next";
import { analyticsUrl } from "@/lib/analyticsUrl";

/** Visit counts with Vercel Web Analytics: no cookies, and a visitor is a hash of the request that is discarded after
 *  24 hours. Every page address is cleaned first (lib/analyticsUrl.ts), so no wallet address is ever sent. */
export default function SiteAnalytics() {
  return <Analytics beforeSend={(e) => ({ ...e, url: analyticsUrl(e.url) })} />;
}
