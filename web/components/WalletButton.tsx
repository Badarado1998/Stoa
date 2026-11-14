"use client";
import { useAccount } from "wagmi";
import { useNet, useWalletModal } from "./Providers";
import { short } from "./WalletModal";

export default function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { open } = useWalletModal();
  const elysium = useNet().chain;
  if (!isConnected) return <button className="cta" type="button" onClick={open}>Connect</button>;
  const wrong = chainId !== elysium.id;
  return (
    <button className={wrong ? "cta" : "ghost"} type="button" onClick={open} style={wrong ? { background: "#B4532A" } : undefined}>
      <span className="addrchip">{wrong ? "Wrong network" : short(address)}</span>
    </button>
  );
}
