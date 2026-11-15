import type { MetadataRoute } from "next";
import { SITE } from "@/lib/chain";
import { flatDocs } from "@/lib/docs";
import { CA } from "@/lib/stoaAddress";
import type { Launch } from "@/lib/ponsLaunch";

const PAGES = ["", "/trade", "/pools", "/earn", "/curators", "/token", "/build", "/referrals", "/docs", "/changelog", "/launches", "/stats"];
/** rebuilt every hour: the token pages of the launches closest to graduation and the latest graduations */
export const revalidate = 3600;

async function launchPages(): Promise<string[]> {
  try {
    const r = await fetch(`${SITE}/api/pons/launches`, { signal: AbortSignal.timeout(8_000) });
    const d = (await r.json()) as { launches?: Launch[] };
    const all = d.launches ?? [];
    const live = all.filter((l) => !l.graduated).sort((a, b) => b.progress - a.progress).slice(0, 40);
    const grads = all.filter((l) => l.graduated);
    return [...live, ...grads].map((l) => l.token);
  } catch {
    return []; // the API is slow or down: the static pages still go out
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.replace(/\/$/, "");
  const tokens = [...new Set([CA, ...(await launchPages())])];
  return [
    ...PAGES.map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.7 })),
    ...flatDocs().map((d) => ({ url: `${base}/docs/${d.slug}`, changeFrequency: "monthly" as const, priority: 0.5 })),
    ...tokens.map((t) => ({ url: `${base}/launches/${t}`, changeFrequency: "hourly" as const, priority: t === CA ? 0.7 : 0.4 })),
  ];
}
