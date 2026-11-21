import { SITE } from "@/lib/chain";

// GET /.well-known/farcaster.json: the Farcaster Mini App manifest. The account association proves the domain belongs to
// Stoa's Farcaster account: it is signed once in the Farcaster app (Developers → Mini App manifest tool) and its three
// values go in Vercel as FARCASTER_ASSOC_HEADER, FARCASTER_ASSOC_PAYLOAD and FARCASTER_ASSOC_SIGNATURE. They are a
// public signature, not a secret. Without them the app still opens from shared links; it just isn't verified or listed.
export const dynamic = "force-static";

export function GET() {
  const h = process.env.FARCASTER_ASSOC_HEADER, p = process.env.FARCASTER_ASSOC_PAYLOAD, s = process.env.FARCASTER_ASSOC_SIGNATURE;
  return Response.json({
    ...(h && p && s ? { accountAssociation: { header: h, payload: p, signature: s } } : {}),
    miniapp: {
      version: "1",
      name: "Stoa",
      iconUrl: `${SITE}/fc-icon.png`,
      homeUrl: `${SITE}/trade?chain=robinhood`,
      imageUrl: `${SITE}/fc-embed.png`,
      buttonTitle: "Open Stoa",
      splashImageUrl: `${SITE}/fc-splash.png`,
      splashBackgroundColor: "#EEF2F8",
      subtitle: "Swaps on Robinhood Chain",
      description: "Every swap compared across every venue on Robinhood Chain, with a free token safety check, stock tokens and Spotlight.",
      primaryCategory: "finance",
      tags: ["swap", "robinhood", "stocks", "defi", "spotlight"],
      tagline: "Every route, compared",
      ogTitle: "Stoa",
      ogDescription: "Every swap compared across every venue on Robinhood Chain.",
      ogImageUrl: `${SITE}/fc-embed.png`,
    },
  }, { headers: { "cache-control": "public, max-age=300" } });
}
