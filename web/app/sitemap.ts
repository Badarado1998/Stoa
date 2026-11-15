import type { MetadataRoute } from "next";
import { SITE } from "@/lib/chain";
import { flatDocs } from "@/lib/docs";

const PAGES = ["", "/trade", "/pools", "/earn", "/curators", "/token", "/build", "/referrals", "/docs", "/changelog", "/launches"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE.replace(/\/$/, "");
  return [
    ...PAGES.map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.7 })),
    ...flatDocs().map((d) => ({ url: `${base}/docs/${d.slug}`, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
