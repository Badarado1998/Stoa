"use client";
import { useCallback, useEffect, useState } from "react";

/** Trade's Lite view: only the tokens, the amount and the Swap button; the details stay one tap away. The choice is
 *  remembered in this browser (localStorage), and a link can open it with ?view=lite or ?view=pro. Same router, same
 *  quotes: only what is shown changes. Inside Telegram or Farcaster (a small in-app screen) Lite is the default until
 *  the visitor picks. */
const KEY = "stoa:tradeView";
export const HOST_EVENT = "stoa:host"; // fired by MiniAppBridge once it knows Stoa runs inside Telegram or Farcaster

const inHost = () => { try { return !!sessionStorage.getItem("stoa:host") || /tgWebApp/.test(location.hash); } catch { return false; } };

export function useTradeLite(): [boolean, (on: boolean) => void] {
  const [lite, setLiteState] = useState(false);
  useEffect(() => {
    let saved: string | null = null;
    try {
      const v = new URLSearchParams(location.search).get("view");
      if (v === "lite" || v === "pro") { setLiteState(v === "lite"); localStorage.setItem(KEY, v); return; }
      saved = localStorage.getItem(KEY);
    } catch { /* storage can be blocked: keep the default */ }
    if (saved) { setLiteState(saved === "lite"); return; }
    if (inHost()) setLiteState(true);
    const on = () => setLiteState(true);
    window.addEventListener(HOST_EVENT, on);
    return () => window.removeEventListener(HOST_EVENT, on);
  }, []);
  const setLite = useCallback((on: boolean) => {
    setLiteState(on);
    try { localStorage.setItem(KEY, on ? "lite" : "pro"); } catch { /* not remembered, still switched */ }
  }, []);
  return [lite, setLite];
}
