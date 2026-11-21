/** Who a request comes from, for per-visitor quotas: the client IP Vercel puts first in x-forwarded-for. An IPv6
 *  visitor gets a whole /64 from their provider, so they are counted by that /64, not by one address of it. */
export function visitorOf(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  if (!ip.includes(":")) return ip;
  const parts = ip.split("::")[0].split(":");
  return `${parts.slice(0, 4).join(":")}::/64`;
}
