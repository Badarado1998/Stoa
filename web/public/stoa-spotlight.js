/* Stoa Spotlight cards for any website. Paste one line where the card should show:
   <script src="https://stoadex.com/stoa-spotlight.js" data-token="0xYourToken" defer></script>
     a project's "Vote for us" card: its bid this week, its votes against the quorum, and a button to vote on Stoa.
   <script src="https://stoadex.com/stoa-spotlight.js" defer></script>
     the whole race: this week's bids, each token's votes, which ones win now. Optional: data-rows="5" (3 to 8).
   Both open Stoa in a new tab and never connect a wallet. Optional: data-width="360" (pixels); the race also takes data-theme="dark". */
(function () {
  var s = document.currentScript; if (!s) return;
  var t = s.getAttribute("data-token") || "";
  if (t && !/^0x[0-9a-fA-F]{40}$/.test(t)) return;
  var w = parseInt(s.getAttribute("data-width") || "380", 10); if (!(w >= 280 && w <= 600)) w = 380;
  var dark = s.getAttribute("data-theme") === "dark";
  var f = document.createElement("iframe"), h;
  if (t) {
    f.src = "https://stoadex.com/embed/spotlight/" + t.toLowerCase();
    f.title = "Vote in Stoa Spotlight"; h = 272;
  } else {
    var n = parseInt(s.getAttribute("data-rows") || "5", 10); if (!(n >= 3 && n <= 8)) n = 5;
    f.src = "https://stoadex.com/embed/spotlight?rows=" + n + (dark ? "&theme=dark" : "");
    f.title = "Stoa Spotlight race"; h = 190 + n * 66;
  }
  f.loading = "lazy";
  f.style.cssText = "display:block;width:100%;max-width:" + w + "px;height:" + h + "px;border:0;border-radius:16px;background:transparent";
  s.parentNode.insertBefore(f, s);
})();
