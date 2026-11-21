"use client";
import Link from "next/link";
import { useReadContract } from "wagmi";
import { ROBINHOOD } from "@/lib/networks";
import { BID_WINDOW, SLOTS, SPOT, SPOT_START, WEEK, epochAt, epochStart, left, spotlightAbi } from "@/lib/spotlight";

const QUORUM = 1_000_000; // $STOA of votes a token needs to win (SpotlightMarket's quorum; the race panels read it on chain)
import { useNow, useSpotLive } from "./spotlightData";

const net = ROBINHOOD;
const cmp = (v: bigint) => Number(v / 10n ** 18n).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** A one-line Spotlight call to action: the countdown to the next step and the $STOA locked so far, linking to the
 *  lock panel. `pill` sits under the home hero, `bar` above Trade. Renders nothing until mounted or without the
 *  contract. */
export default function SpotlightBanner({ variant = "bar" }: { variant?: "pill" | "bar" }) {
  const live = useSpotLive();
  const now = useNow(30_000);
  const locked = useReadContract({
    address: SPOT, abi: spotlightAbi, functionName: "totalLocked", chainId: net.chain.id,
    query: { enabled: live, refetchInterval: 60_000 },
  }).data as bigint | undefined;
  if (!live || now === 0) return null;

  const e = epochAt(now);
  let text: string, cta: string, href: string;
  if (e < 0) {
    text = variant === "pill" ? `Spotlight opens in ${left(SPOT_START - now)}` : `Spotlight week 1 opens in ${left(SPOT_START - now)}`;
    cta = "Lock $STOA";
    href = "/spotlight#lock";
  } else {
    const start = epochStart(e);
    const bids = now < start + BID_WINDOW;
    text = bids ? `Spotlight week ${e + 1}: bids close in ${left(start + BID_WINDOW - now)}` : `Spotlight week ${e + 1}: votes close in ${left(start + WEEK - now)}`;
    cta = "Vote";
    href = "/spotlight";
  }
  // each winning token needs QUORUM votes, so every QUORUM of locked $STOA can fill one more slot: say how far the next is
  const full = locked !== undefined ? Number(locked / 10n ** 18n) : 0;
  const slots = Math.min(SLOTS, Math.floor(full / QUORUM));
  const nextSlot = slots < SLOTS ? `${cmp(BigInt(QUORUM * (slots + 1) - full) * 10n ** 18n)} more opens slot ${slots + 1}` : null;
  const lockTxt = !locked ? null : `${cmp(locked)} $STOA locked${nextSlot && variant === "bar" ? ` · ${nextSlot}` : ""}`; // hidden until someone locks

  return (
    <Link href={href} prefetch={false} className={`spotban ${variant}`} aria-label={`${text}. ${lockTxt ?? ""} ${cta}`}>
      <span className="sb-dot" aria-hidden="true" />
      <span className="sb-t">{text}{lockTxt && <small> · {lockTxt}</small>}</span>
      <span className="sb-go">{cta} →</span>
    </Link>
  );
}
