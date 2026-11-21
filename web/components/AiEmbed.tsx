"use client";
import { useRef, useState, useEffect } from "react";
import { Avatar, CardView, Dots, Rich, streamChat } from "./AiChat";

/** Stoa AI inside a project's own site (/embed/ai): the same assistant, scoped to one token, read-only. No wallet ever
 *  connects in the frame; Buy opens Stoa in a new tab. */
type M = { role: "user" | "assistant"; content: string; cards: { kind: string; data: Record<string, unknown> | unknown[] }[]; status?: string; error?: string; suggest?: string[] };

export default function AiEmbed({ token, symbol, logo, buy }: { token: string; symbol: string; logo: string | null; buy: string }) {
  const [msgs, setMsgs] = useState<M[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // scroll the chat itself, never the page around the frame (scrollIntoView would move the host page too)
  useEffect(() => { if (msgs.length && box.current) box.current.scrollTop = box.current.scrollHeight; }, [msgs]);
  const starters = [`Is ${symbol} safe?`, `What does 0.01 ETH buy in ${symbol}?`, `Who holds ${symbol}?`];

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    const history = [...msgs, { role: "user" as const, content: t, cards: [] }];
    const idx = history.length;
    setMsgs([...history, { role: "assistant", content: "", cards: [] }]);
    setBusy(true);
    const patch = (f: (m: M) => M) => setMsgs((cur) => cur.map((m, i) => (i === idx ? f(m) : m)));
    try {
      await streamChat({ project: token, messages: history.map((m) => ({ role: m.role, content: m.content })) }, (ev) => {
        if (ev.t === "text") patch((m) => ({ ...m, content: m.content + (ev.d ?? ""), status: undefined }));
        else if (ev.t === "status") patch((m) => ({ ...m, status: ev.d }));
        else if (ev.t === "card") patch((m) => ({ ...m, cards: [...m.cards, { kind: ev.kind!, data: ev.data as M["cards"][number]["data"] }] }));
        else if (ev.t === "suggest") patch((m) => ({ ...m, suggest: ev.items }));
        else if (ev.t === "error") patch((m) => ({ ...m, error: ev.d }));
      });
    } catch { patch((m) => ({ ...m, error: "The assistant could not answer right now." })); }
    finally { patch((m) => ({ ...m, status: undefined })); setBusy(false); }
  }
  const shown = (s: string) => s.split(/\n?\s*NEXT:/i)[0].trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#fff", fontSize: 15 }}>
      <style>{`@keyframes stoaDot{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}} .ae-chip{flex:none;border:1px solid #cfdcf3;background:#f4f8ff;color:#1f4fa8;border-radius:999px;padding:7px 12px;font-size:13.5px;cursor:pointer}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid #eef1f5" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo ? <img src={logo} alt="" width={32} height={32} style={{ borderRadius: "50%" }} /> : <Avatar size={32} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{symbol} assistant <span style={{ fontSize: 10.5, fontWeight: 700, color: "#1f4fa8", background: "#eaf1ff", borderRadius: 6, padding: "1px 6px" }}>BETA</span></div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Stoa AI · on-chain data</div>
        </div>
        <a href={buy} target="_blank" rel="noopener noreferrer" style={{ flex: "none", padding: "8px 12px", fontSize: 13.5, fontWeight: 600, background: "var(--accent)", color: "#fff", borderRadius: 999, textDecoration: "none" }}>Buy on Stoa ↗</a>
      </div>
      <div ref={box} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {!msgs.length && (
          <div>
            <div style={{ display: "flex", gap: 10 }}><Avatar /><div style={{ background: "#f3f6fb", borderRadius: "4px 16px 16px 16px", padding: "10px 14px", lineHeight: 1.5 }}>Hi! Ask me about {symbol}: its safety check, price, liquidity and holders, straight from the chain. I don&apos;t know the team&apos;s plans, and this is not financial advice.</div></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, marginLeft: 40 }}>{starters.map((q) => <button key={q} type="button" className="ae-chip" onClick={() => void send(q)}>{q}</button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "linear-gradient(135deg,#2F6FD6,#4C97F0)", color: "#fff", padding: "9px 13px", borderRadius: "16px 16px 4px 16px", whiteSpace: "pre-wrap" }}>{m.content}</div>
        ) : (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Avatar />
            <div style={{ flex: 1, minWidth: 0 }}>
              {m.status && <div className="note" style={{ margin: "4px 0", display: "flex", gap: 8, alignItems: "center" }}><Dots /> {m.status}</div>}
              {m.cards.map((c, k) => <CardView key={k} c={c} ask={(q) => void send(q)} />)}
              {(m.content || (busy && i === msgs.length - 1 && !m.status)) && <div style={{ background: "#f3f6fb", borderRadius: "4px 16px 16px 16px", padding: "9px 13px", lineHeight: 1.55, whiteSpace: "pre-wrap", marginTop: m.cards.length ? 8 : 0 }}>{shown(m.content) ? <Rich text={shown(m.content)} /> : <Dots />}</div>}
              {m.error && <div className="notice" style={{ marginTop: 8 }}>{m.error}</div>}
              {i === msgs.length - 1 && !busy && m.suggest && <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 8 }}>{m.suggest.map((q) => <button key={q} type="button" className="ae-chip" onClick={() => void send(q)}>{q}</button>)}</div>}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send(input); }} style={{ padding: "8px 10px", borderTop: "1px solid #eef1f5" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", background: "#f3f6fb", borderRadius: 999, padding: "3px 3px 3px 14px" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Ask about ${symbol}…`} maxLength={600} disabled={busy} aria-label="Message" style={{ flex: 1, fontSize: 16, border: 0, background: "transparent", outline: "none", minWidth: 0, padding: "7px 0" }} />
          <button type="submit" aria-label="Send" disabled={busy || !input.trim()} style={{ width: 36, height: 36, borderRadius: "50%", border: 0, background: busy || !input.trim() ? "#c9d3e3" : "var(--accent)", color: "#fff", cursor: "pointer" }}>↑</button>
        </div>
        <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", marginTop: 5 }}><a href="https://stoadex.com/ai" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>Powered by <b>Stoa AI</b></a> · Not financial advice</div>
      </form>
    </div>
  );
}
