import "server-only";

/** Upstash Redis over its REST API, when installed (Vercel Marketplace sets KV_REST_API_URL / KV_REST_API_TOKEN, an
 *  Upstash console copy UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Without it `kvOn` is false and every call
 *  returns null: features that need storage say they are not switched on yet. Connected 21 Nov 2026 (free plan). */
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const kvOn = !!(URL_ && TOKEN);

export async function kv<T = unknown>(...cmd: (string | number)[]): Promise<T | null> {
  if (!kvOn) return null;
  const r = await fetch(URL_, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(cmd.map(String)), signal: AbortSignal.timeout(5000), cache: "no-store" }).catch(() => null);
  if (!r?.ok) return null;
  const j = (await r.json().catch(() => null)) as { result?: T } | null;
  return j?.result ?? null;
}
