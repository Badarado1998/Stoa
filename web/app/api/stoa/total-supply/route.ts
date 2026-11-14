import { readSupply, units } from "@/lib/stoaSupply";

export const revalidate = 300;

/** plain number, the format CoinGecko and CoinMarketCap read */
export async function GET() {
  try {
    const s = await readSupply();
    return new Response(units(s.total), { headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch {
    return new Response("unavailable", { status: 503 });
  }
}
