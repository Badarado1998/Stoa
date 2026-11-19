import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { questProgress } from "@/lib/wrapped";
import { QUEST } from "@/lib/quest";

// POST /api/quest/zealy?task=swap|lock, for Zealy's API task. Zealy posts { userId, communityId, subdomain, questId,
// requestId, accounts: { wallet } } and reads only the status: 200 = task done, 400 = not yet, with { message } shown to
// the user. Read-only and about public chain data, so no API key.
export const runtime = "nodejs";
export const maxDuration = 10;

const no = (message: string) => NextResponse.json({ message }, { status: 400 });

export async function POST(req: Request) {
  const task = new URL(req.url).searchParams.get("task");
  if (task !== "swap" && task !== "lock") return no("This task is set up with an unknown check. Tell the Stoa team.");
  let wallet = "";
  try { wallet = String(((await req.json()) as { accounts?: { wallet?: string } })?.accounts?.wallet ?? "").trim(); } catch { /* below */ }
  if (!isAddress(wallet)) return no("Connect an EVM wallet to Zealy first, then claim again.");
  try {
    const p = await Promise.race([
      questProgress(wallet, QUEST.start, QUEST.end, QUEST.minUsd),
      new Promise<null>((_, rej) => setTimeout(() => rej(new Error("slow")), 8_500)),
    ]);
    if (!p) return no("That wallet address is not valid.");
    if (task === "swap") {
      return p.qualifying > 0
        ? NextResponse.json({ message: `Done: ${p.qualifying} swap${p.qualifying > 1 ? "s" : ""} of $${QUEST.minUsd}+ through Stoa.` })
        : no(`No swap of $${QUEST.minUsd} or more through Stoa on Robinhood Chain from this wallet since the quest opened. Swap on stoadex.com/trade, wait a minute, then claim again.`);
    }
    return p.locked > 0
      ? NextResponse.json({ message: `Done: ${Math.floor(p.locked).toLocaleString("en-US")} $STOA locked.` })
      : no("No $STOA locked from this wallet yet. Lock any amount on stoadex.com/spotlight, then claim again.");
  } catch {
    return no("Robinhood Chain did not answer in time. Wait a minute and claim again.");
  }
}
