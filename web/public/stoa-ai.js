/* Stoa AI chat button for a project's own website.
   <script src="https://stoadex.com/stoa-ai.js" data-token="0xYourToken" defer></script>
   Adds a round button at the bottom right; it opens Stoa AI for that token in a frame (stoadex.com/embed/ai). The frame
   never connects a wallet. Optional: data-ref="0xYourWallet" (referral on Buy), data-side="left". */
(function () {
  var s = document.currentScript; if (!s) return;
  var t = s.getAttribute("data-token") || ""; if (!/^0x[0-9a-fA-F]{40}$/.test(t)) return;
  var ref = s.getAttribute("data-ref") || "", side = s.getAttribute("data-side") === "left" ? "left" : "right";
  var src = "https://stoadex.com/embed/ai?token=" + t + (/^0x[0-9a-fA-F]{40}$/.test(ref) ? "&ref=" + ref : "");
  var b = document.createElement("button");
  b.type = "button"; b.setAttribute("aria-label", "Ask Stoa AI");
  b.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;z-index:2147483646;background:#fff url(https://stoadex.com/stoa-logo-200.png) center/70% no-repeat;box-shadow:0 8px 24px rgba(30,40,80,.25)";
  var f = null;
  b.onclick = function () {
    if (!f) {
      f = document.createElement("iframe");
      f.src = src; f.title = "Stoa AI";
      f.style.cssText = "position:fixed;bottom:86px;" + side + ":20px;width:min(380px,calc(100vw - 40px));height:min(600px,calc(100vh - 120px));border:0;border-radius:18px;box-shadow:0 18px 50px rgba(30,40,80,.3);z-index:2147483647;background:#fff";
      document.body.appendChild(f);
    } else f.style.display = f.style.display === "none" ? "" : "none";
  };
  document.body.appendChild(b);
})();
