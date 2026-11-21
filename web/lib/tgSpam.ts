/** Scam patterns for the anti-spam option of the Telegram bot (/antispam on). A message is removed only when one of these
 *  matches and its sender is not an admin. Kept narrow: a false positive deletes a real member's message. */
// words spelled with gaps ("w a r n", "f.a.r.m") to dodge filters. One spaced word alone flags only if it is a scam word,
// so a ticker typed as "U S D G" stays; two or more spaced words in one message flag.
const SPACED = /(?:^|[^\p{L}])((?:\p{L}[ .\-_*]){2,}\p{L})(?![\p{L}])/gu;
const SCAM_WORDS = /^(warn|warning|farm|scam|scammer|rug|rugged|rugpull|proof|dm|inbox|airdrop|claim|wallet|admin|support|honeypot|fake|ponzi|exit|drain|drainer|refund|seed|bonus|giveaway|presale|free|exposed)$/;
const SECRETS = /\b(seed|recovery|secret)\s*phrase\b|\bprivate\s*key\b|\b(validate|verify|sync|rectify|connect)\s+(your\s+)?wallet\b|\bwallet\s*connect\b/i;
const DM_BAIT = /\b(dm|pm|inbox|message)\s+(me|us|admin|support)\b|\b(contact|reach)\s+(the\s+)?(admin|support|team)\s+(at|on|via)\b/i;
const LINK = /https?:\/\/|\bwww\.|\bt\.me\/|\btelegram\.me\/|\b[a-z0-9-]+\.(xyz|top|live|site|online|click|link|app|io|com|net|org|finance|gift|claims?)\b/i;

export type SpamWhy = "spaced letters" | "asks for a seed phrase or wallet sync" | "asks to DM" | "a link from a new member";

/** why this message looks like a scam, or null. `isNew`: the sender joined the group in the last 24 hours. */
export function spamWhy(text: string, isNew: boolean): SpamWhy | null {
  const t = text.normalize("NFKC");
  if (SECRETS.test(t)) return "asks for a seed phrase or wallet sync";
  const spaced = [...t.matchAll(SPACED)].map((x) => x[1].replace(/[ .\-_*]/g, "").toLowerCase());
  // "a s c a m" reads as one run "ascam": also try it without a leading one-letter word
  if (spaced.length >= 2 || spaced.some((w) => SCAM_WORDS.test(w) || SCAM_WORDS.test(w.slice(1)))) return "spaced letters";
  if (DM_BAIT.test(t)) return "asks to DM";
  if (isNew && LINK.test(t.replace(/(https?:\/\/)?(www\.)?stoadex\.com\S*/gi, ""))) return "a link from a new member"; // Stoa's own links are fine
  return null;
}
