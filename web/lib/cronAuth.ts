import "server-only";

/** Vercel cron calls carry "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set in the project. With it set,
 *  the cron routes (and the Telegram setup, with ?key=) answer only those calls; without it they stay open and rely on
 *  their locks in storage. */
const SECRET = process.env.CRON_SECRET || "";

export function cronAllowed(req: Request): boolean {
  if (!SECRET) return true;
  if (req.headers.get("authorization") === `Bearer ${SECRET}`) return true;
  return new URL(req.url).searchParams.get("key") === SECRET;
}

export const cronRefused = () => Response.json({ error: "forbidden" }, { status: 403 });
