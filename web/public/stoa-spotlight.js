/* Stoa Spotlight "Vote for us" card for a project's own website.
   <script src="https://stoadex.com/stoa-spotlight.js" data-token="0xYourToken" defer></script>
   Puts a small card where the script tag is: your token's Spotlight bid this week, its votes against the quorum, and a
   button to vote on Stoa (opens a new tab). The card never connects a wallet. Optional: data-width="360" (pixels). */
(function () {
  var s = document.currentScript; if (!s) return;
  var t = s.getAttribute("data-token") || ""; if (!/^0x[0-9a-fA-F]{40}$/.test(t)) return;
  var w = parseInt(s.getAttribute("data-width") || "380", 10); if (!(w >= 280 && w <= 600)) w = 380;
  var f = document.createElement("iframe");
  f.src = "https://stoadex.com/embed/spotlight/" + t.toLowerCase();
  f.title = "Vote in Stoa Spotlight"; f.loading = "lazy";
  f.style.cssText = "display:block;width:100%;max-width:" + w + "px;height:272px;border:0;border-radius:16px;background:transparent";
  s.parentNode.insertBefore(f, s);
})();
