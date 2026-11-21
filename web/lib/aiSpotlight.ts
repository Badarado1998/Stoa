import "server-only";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, isAddress, parseUnits, type Address } from "viem";
import { ROBINHOOD } from "./networks";
import { srv } from "./serverRpc";
import { SPOT, SPOT_START, WEEK, epochAt, spotlightAbi } from "./spotlight";

/** Spotlight for Stoa AI: lock $STOA, or set this week's votes, as a card the user signs. Built for the connected wallet
 *  and checked against the contract first (a listed, live candidate; enough locked $STOA). vote() replaces a wallet's
 *  votes for the week, so the card always carries the wallet's full set: earlier votes kept, this one added or changed. */
const STOA = "0x13E6993417616De724F2b337D65063f229e96718" as Address;
const c = () => createPublicClient({ chain: ROBINHOOD.chain, transport: http(srv(ROBINHOOD.logsRpc), { timeout: 15_000 }) });
const n = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 });

export async function prepareSpotlight(a: Record<string, unknown>, wallet: Address | null) {
  if (!SPOT) return { error: "Spotlight is not live." };
  const S: Address = SPOT;
  if (!wallet) return { error: "No wallet connected. Ask the user to connect a wallet first." };
  const pc = c();
  const what = String(a.action ?? "");
  const [paused, acct, bal] = await Promise.all([
    pc.readContract({ address: S, abi: spotlightAbi, functionName: "paused" }),
    pc.readContract({ address: S, abi: spotlightAbi, functionName: "accounts", args: [wallet] }),
    pc.readContract({ address: STOA, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
  ]);
  if (paused) return { error: "Spotlight is paused for safety right now." };
  const [active] = acct;

  if (what === "lock") {
    const amt = String(a.amount ?? "").toLowerCase() === "all" ? bal : (() => { try { return parseUnits(String(a.amount ?? ""), 18); } catch { return 0n; } })();
    if (amt <= 0n) return { error: "amount must be a number of $STOA, or \"all\"" };
    if (amt > bal) return { error: `This wallet holds ${n(bal)} $STOA, less than that.` };
    return {
      summary: { action: "lock", amount: n(amt), lockedNow: n(active), lockedAfter: n(active + amt), opensAt: new Date(SPOT_START * 1000).toISOString() },
      call: { spotlight: S, stoa: STOA, action: "lock", amount: amt.toString() },
      note: "Locked $STOA votes every week until you request an unlock (it then stops voting and can be withdrawn after the unlock wait). Two steps: approve, then lock.",
    };
  }

  if (what === "vote") {
    const now = Math.floor(Date.now() / 1000), ep = epochAt(now);
    if (ep < 0) return { error: `Voting starts when week 1 opens, ${new Date(SPOT_START * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC. You can lock $STOA now so it is ready.` };
    const tok = String(a.token ?? "");
    if (!isAddress(tok, { strict: false })) return { error: "token must be the candidate's token address (see the spotlight tool)." };
    const t = getAddress(tok);
    const cand = await pc.readContract({ address: S, abi: spotlightAbi, functionName: "candidates", args: [BigInt(ep), t] });
    if (!cand[4]) return { error: "That token is not a Spotlight candidate this week." };
    if (cand[5]) return { error: "That candidate was canceled this week." };
    const prev = await pc.readContract({ address: S, abi: spotlightAbi, functionName: "votedTokens", args: [BigInt(ep), wallet] });
    const amounts = await Promise.all(prev.map((p) => pc.readContract({ address: S, abi: spotlightAbi, functionName: "votesOf", args: [BigInt(ep), p, wallet] })));
    const set = new Map(prev.map((p, i) => [getAddress(p), amounts[i]]));
    const others = [...set].filter(([k]) => k !== t).reduce((s, [, v]) => s + v, 0n);
    const amt = String(a.amount ?? "").toLowerCase() === "all" ? active - others : (() => { try { return parseUnits(String(a.amount ?? ""), 18); } catch { return 0n; } })();
    if (active === 0n) return { error: `No $STOA is locked in this wallet yet (it holds ${n(bal)}). Lock first: locked $STOA is what votes.` };
    if (amt <= 0n) return { error: "Nothing left to vote with: all locked $STOA already votes for other candidates. Give an amount to move votes." };
    if (others + amt > active) return { error: `Only ${n(active)} $STOA is locked and ${n(others)} already votes for other candidates.` };
    set.set(t, amt);
    const list = [...set].filter(([, v]) => v > 0n);
    return {
      summary: { action: "vote", week: ep + 1, token: t, amount: n(amt), votes: list.map(([k, v]) => ({ token: k, amount: n(v) })), locked: n(active), votesCloseAt: new Date((SPOT_START + (ep + 1) * WEEK) * 1000).toISOString() },
      call: { spotlight: S, action: "vote", tokens: list.map(([k]) => k), amounts: list.map(([, v]) => v.toString()) },
      note: "Saving votes replaces this wallet's votes for the week; earlier votes for other candidates are kept on this card.",
    };
  }
  return { error: 'action must be "lock" or "vote"' };
}
