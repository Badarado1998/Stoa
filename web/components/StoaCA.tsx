"use client";
import { useState } from "react";
import { addressUrl } from "@/lib/chain";
import { useStoaToken } from "@/lib/stoaToken";

/** "$STOA · CA" line in the footer, shown once the launch is on-chain. */
export default function StoaCA({ short = false }: { short?: boolean }) {
  const t = useStoaToken();
  const [copied, setCopied] = useState(false);
  if (!t) return null;
  return (
    <p className="note stoaca">
      <b>${t.symbol}</b>{" "}
      <a href={addressUrl(t.address)} target="_blank" rel="noopener noreferrer"><span className="addrchip">{short ? `${t.address.slice(0, 8)}…${t.address.slice(-6)}` : t.address}</span></a>{" "}
      <button type="button" className="cp" onClick={() => { navigator.clipboard?.writeText(t.address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
    </p>
  );
}
