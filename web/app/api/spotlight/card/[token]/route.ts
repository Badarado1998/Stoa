import { isAddress } from "viem";
import Image from "@/app/(app)/spotlight/vote/[token]/opengraph-image";

// GET /api/spotlight/card/<token>: the "Vote for $X" card of a Spotlight candidate as a PNG download, for its team to
// post on X or Telegram. The same image as the vote page's share card; it follows the bid and votes (kept 2 minutes).
export const revalidate = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAddress(token, { strict: false })) return Response.json({ error: "not a token address" }, { status: 400 });
  const img = await Image({ params: Promise.resolve({ token }) });
  return new Response(img.body, {
    headers: {
      "content-type": "image/png",
      "content-disposition": `attachment; filename="stoa-spotlight-${token.toLowerCase().slice(0, 10)}.png"`,
      "cache-control": "public, max-age=0, s-maxage=120, stale-while-revalidate=600",
    },
  });
}
