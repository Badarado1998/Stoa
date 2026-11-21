"use client";
import { useCallback, useEffect, useState } from "react";

/** Trade's Lite view: only the tokens, the amount and the Swap button; the details stay one tap away. The choice is
 *  remembered in this browser (localStorage), and a link can open it with ?view=lite or ?view=pro. Same router, same
 *  quotes: only what is shown changes. */
const KEY = "stoa:tradeView";

export function useTradeLite(): [boolean, (on: boolean) => void] {
  const [lite, setLiteState] = useState(false);
  useEffect(() => {
    try {
      const v = new URLSearchParams(location.search).get("view");
      if (v === "lite" || v === "pro") { setLiteState(v === "lite"); localStorage.setItem(KEY, v); return; }
      setLiteState(localStorage.getItem(KEY) === "lite");
    } catch { /* storage can be blocked: keep Pro */ }
  }, []);
  const setLite = useCallback((on: boolean) => {
    setLiteState(on);
    try { localStorage.setItem(KEY, on ? "lite" : "pro"); } catch { /* not remembered, still switched */ }
  }, []);
  return [lite, setLite];
}
