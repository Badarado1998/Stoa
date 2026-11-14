import { CA } from "@/lib/stoaAddress";
import { BURN, STOA_CURVE, readSupply, units } from "@/lib/stoaSupply";

export const revalidate = 300;

/** $STOA supply for trackers (CoinGecko, CoinMarketCap) and anyone else, read from Robinhood Chain every 5 minutes. */
export async function GET() {
  try {
    const s = await readSupply();
    return Response.json({
      token: CA,
      chain: "Robinhood Chain (4663)",
      max_supply: units(s.max),
      total_supply: units(s.total),
      circulating_supply: units(s.circulating),
      burned: units(s.burned),
      on_bonding_curve: units(s.inCurve),
      bonding_curve: { address: STOA_CURVE, eth: units(s.curveEth, 6), graduation_eth: units(s.threshold, 6), graduated: s.graduated },
      method: `total = minted - balance of ${BURN}; circulating = total - unsold $STOA on the Pons bonding curve`,
      updated: new Date().toISOString(),
    });
  } catch {
    return Response.json({ error: "Robinhood Chain RPC unavailable, try again shortly" }, { status: 503 });
  }
}
