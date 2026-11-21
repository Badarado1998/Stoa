import { getAddress, isAddress, type Address } from "viem";
import { runAgent, type AiEvent } from "@/lib/aiAgent";
import { FREE_PER_DAY, takeMessage } from "@/lib/aiCredits";
import { projectContext, PROJECT_TOOLS } from "@/lib/aiProject";

// POST /api/ai/chat {messages: [{role: "user"|"assistant", content}], wallet?, project?}: Stoa's assistant on OpenRouter
// (lib/aiAgent.ts), streamed back as newline-delimited JSON:
//   {t:"text", d}      a piece of the reply          {t:"status", d}   what it is checking right now
//   {t:"card", kind, data}  a tool result to show     {t:"action", tool, data}  a swap, limit order or payment link to act on
//   {t:"suggest", items}    follow-ups to tap          {t:"done", left} / {t:"error", d, left}
// `project` (a token address) is the widget other projects put on their sites (/embed/ai): it answers about that token,
// reads only, and never connects a wallet. It can read, quote and build; it cannot sign or send.
export const dynamic = "force-dynamic";
export const maxDuration = 60;


export async function POST(req: Request) {
  if (!process.env.OPENROUTER_API_KEY) return Response.json({ error: "The assistant is not switched on yet." }, { status: 503 });
  const b = (await req.json().catch(() => null)) as { messages?: { role?: string; content?: string }[]; wallet?: string; project?: string } | null;
  const history = (b?.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-12)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content!.slice(0, 2000) }));
  if (!history.length || history[history.length - 1].role !== "user") return Response.json({ error: "bad request" }, { status: 400 });
  const project: Address | null = b?.project && isAddress(b.project, { strict: false }) ? getAddress(b.project) : null;
  const wallet: Address | null = !project && b?.wallet && isAddress(b.wallet, { strict: false }) ? getAddress(b.wallet) : null;

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  // free messages per visitor, then the connected wallet's credits (lib/aiCredits.ts)
  const q = await takeMessage(ip, wallet);
  if (!q.ok) return q.why === "user"
    ? Response.json({ error: `That's today's ${FREE_PER_DAY} free messages. Get more with credits, or come back after 00:00 UTC.`, left: 0, credits: q.credits, buy: !project }, { status: 429 })
    : Response.json({ error: "The assistant is very busy today. Try again later." }, { status: 503 });
  const left = q.left, credits = q.credits;
  const extra = project ? await projectContext(project) : undefined;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: AiEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e.t === "done" || e.t === "error" ? { ...e, left, credits } : e) + "\n"));
      try { await runAgent({ history, wallet, emit: send, extra, allow: project ? (n) => PROJECT_TOOLS.has(n) : undefined }); }
      catch { send({ t: "error", d: "The assistant could not answer right now. Try again in a minute." }); }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
