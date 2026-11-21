"use client";
import { useEffect } from "react";
import { HOST_EVENT } from "@/lib/tradeView";

/** Makes Stoa behave as a Mini App when it is opened inside Telegram or a Farcaster client: tells the host the page is
 *  ready (Farcaster keeps its splash screen until then), fills the screen, offers the host's own wallet first, and
 *  opens Trade in Lite. Does nothing in a normal browser: Telegram is recognised from the launch parameters in the URL
 *  hash, and the Farcaster SDK is only fetched when the page runs framed or in a mobile webview. */

export default function MiniAppBridge() {
  useEffect(() => {
    if (location.pathname.startsWith("/embed")) return; // widgets on other sites
    const mark = (host: string) => {
      try { sessionStorage.setItem("stoa:host", host); } catch { /* still works this page */ }
      document.documentElement.dataset.host = host;
      window.dispatchEvent(new Event(HOST_EVENT));
    };
    let tg = false;
    try { tg = /tgWebApp/.test(location.hash) || sessionStorage.getItem("stoa:host") === "telegram"; } catch { /* no storage */ }
    if (tg) {
      mark("telegram");
      // Telegram's events without its script: the mobile apps expose TelegramWebviewProxy, Telegram Web listens for
      // postMessage from the frame (the inline script in the layout already sent ready and expand on mobile)
      const post = (type: string, data: object) => {
        const p = (window as unknown as { TelegramWebviewProxy?: { postEvent(t: string, d: string): void } }).TelegramWebviewProxy;
        try {
          if (p) p.postEvent(type, JSON.stringify(data));
          else if (window.parent !== window) window.parent.postMessage(JSON.stringify({ eventType: type, eventData: data }), "https://web.telegram.org");
        } catch { /* an older Telegram */ }
      };
      post("web_app_ready", {});
      post("web_app_expand", {});
      post("web_app_set_header_color", { color: "#eaf0f8" });
      post("web_app_set_background_color", { color: "#eaf0f8" });
      return;
    }
    const w = window as unknown as { ReactNativeWebView?: unknown };
    if (window.parent === window && !w.ReactNativeWebView) return;
    let stop = false;
    import("@farcaster/miniapp-sdk")
      .then(async ({ sdk }) => {
        if (stop || !(await sdk.isInMiniApp())) return;
        mark("farcaster");
        await sdk.actions.ready();
        const p = await sdk.wallet.getEthereumProvider().catch(() => undefined);
        if (p) (await import("@/lib/wagmi")).addHostWallet(p, "Farcaster wallet");
      })
      .catch(() => { /* not a Farcaster client */ });
    return () => { stop = true; };
  }, []);
  return null;
}
