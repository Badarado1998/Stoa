import type { MetadataRoute } from "next";
import { SITE } from "@/lib/chain";

export default function robots(): MetadataRoute.Robots {
  const base = SITE.replace(/\/$/, "");
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/portfolio"] }], sitemap: `${base}/sitemap.xml` };
}
