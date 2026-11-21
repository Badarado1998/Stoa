"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useWatch } from "@/lib/watchlist";

/** "Notify me on this device": web push for Spotlight moments, ETH to claim (for the connected wallet) and price alerts
 *  while Stoa is closed. On iPhone it works once Stoa is added to the home screen. Sends the subscription, the wallet
 *  address and the alerts to Stoa; turning it off deletes them. Hidden until the push keys are set. */
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const FLAG = "stoa:push";

const b64 = (s: string) => { const p = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)); };

async function sub(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID) }));
}

export default function PushToggle({ compact = false }: { compact?: boolean }) {
  const { address } = useAccount();
  const { alerts } = useWatch();
  const [state, setState] = useState<"unsupported" | "off" | "on" | "busy" | "denied" | "ios">("off");
  useEffect(() => {
    if (!VAPID) { setState("unsupported"); return; }
    const ios = /iPhone|iPad/.test(navigator.userAgent) && !(window.matchMedia("(display-mode: standalone)").matches);
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setState(ios ? "ios" : "unsupported"); return; }
    if (Notification.permission === "denied") { setState("denied"); return; }
    try { setState(localStorage.getItem(FLAG) === "1" && Notification.permission === "granted" ? "on" : "off"); } catch { setState("off"); }
  }, []);
  // keep the wallet and the alerts up to date on Stoa's side while it is on
  const pending = alerts.filter((a) => !a.fired);
  const key = `${address ?? ""}|${pending.map((a) => `${a.id}:${a.price}`).join()}`;
  useEffect(() => {
    if (state !== "on") return;
    (async () => {
      const s = await sub().catch(() => null);
      if (s) await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: s.toJSON(), wallet: address, alerts: pending }) }).catch(() => null);
    })();
  }, [state, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "unsupported") return null;
  if (state === "ios") return compact ? null : <p className="note">On iPhone, add Stoa to your home screen (Share → Add to Home Screen) to get notifications.</p>;
  if (state === "denied") return compact ? null : <p className="note">Notifications are blocked for stoadex.com in this browser&apos;s settings.</p>;
  const on = async () => {
    setState("busy");
    try {
      if ((await Notification.requestPermission()) !== "granted") { setState("denied"); return; }
      const s = await sub();
      if (!s) { setState("off"); return; }
      const r = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: s.toJSON(), wallet: address, alerts: pending }) });
      if (!r.ok) { setState("off"); return; }
      localStorage.setItem(FLAG, "1"); setState("on");
    } catch { setState("off"); }
  };
  const off = async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const s = await reg?.pushManager.getSubscription();
      if (s) { await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: s.endpoint }) }).catch(() => null); await s.unsubscribe(); }
      localStorage.removeItem(FLAG);
    } catch { /* still off on this device */ }
    setState("off");
  };
  return (
    <div className="rowx" style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-start" }}>
      {state === "on"
        ? <button type="button" className="ghost" onClick={off}>🔔 Notifications on · turn off</button>
        : <button type="button" className="ghost" disabled={state === "busy"} onClick={on}>🔔 {state === "busy" ? "Turning on…" : "Notify me on this device"}</button>}
      {!compact && <small className="note" style={{ margin: 0 }}>Spotlight closing times, ETH ready to claim{address ? " for this wallet" : ""}, and your price alerts, even with Stoa closed.</small>}
    </div>
  );
}
