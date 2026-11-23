/**
 * bd-tfya0m (queue #205, the operator via #206's parity audit) — the FICO form's answers (V3 and v6), kept ON THIS
 * PHONE as she gives them, so a reload, the app closed, or a Save that came back 502 loses nothing.
 *
 * The grades 6-8 (FDE) form keeps each part on the server at "Next part"; the FICO form cannot (its one save completes
 * the review, and a v6 review is refused part-way), so it keeps them here, per observation, until the bot has them.
 * A convenience over the server's answers, never instead of them: a read or write that fails is ignored, a copy older
 * than KEEP_DAYS is let go, and only the form's own keys are ever taken back (FeedbackForm restores over the draft's).
 */

export type Kept = { values: Record<string, string>; part: number; at: number };

const PREFIX = "niete-fico-form:";
const KEEP_DAYS = 14;

const keyOf = (id: string) => `${PREFIX}${id}`;

/** Keep her answers and the part she is on. */
export function keepForm(id: string, values: Record<string, string>, part: number): void {
  if (!id) return;
  try {
    window.localStorage.setItem(keyOf(id), JSON.stringify({ values, part, at: Date.now() }));
  } catch { /* storage full or blocked: the form still works, it just cannot keep them */ }
}

/** Her kept answers for this observation, or null (none, unreadable, or older than KEEP_DAYS). */
export function heldForm(id: string): Kept | null {
  if (!id) return null;
  try {
    const raw = window.localStorage.getItem(keyOf(id));
    if (!raw) return null;
    const k = JSON.parse(raw) as Partial<Kept>;
    if (!k || typeof k !== "object" || !k.values || typeof k.values !== "object") return null;
    if (typeof k.at === "number" && Date.now() - k.at > KEEP_DAYS * 86_400_000) { dropForm(id); return null; }
    const values: Record<string, string> = {};
    for (const [key, v] of Object.entries(k.values)) if (typeof v === "string") values[key] = v;
    return { values, part: Number.isInteger(k.part) ? (k.part as number) : 0, at: typeof k.at === "number" ? k.at : 0 };
  } catch {
    return null;
  }
}

/** The bot has them (or they no longer apply): let the phone's copy go. */
export function dropForm(id: string): void {
  if (!id) return;
  try { window.localStorage.removeItem(keyOf(id)); } catch { /* nothing to drop */ }
}

/**
 * The draft's values with her kept answers laid over them — only for keys the form has (an old form's or a foreign
 * key is dropped), so what is saved is always the form's own set.
 */
export function restoreOver(base: Record<string, string>, kept: Kept | null): Record<string, string> {
  if (!kept) return base;
  const out = { ...base };
  for (const k of Object.keys(base)) if (Object.prototype.hasOwnProperty.call(kept.values, k)) out[k] = kept.values[k];
  return out;
}
