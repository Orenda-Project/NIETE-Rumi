/**
 * bd-sex15q.34 — what index.html asked for at boot on a COACHIP page (the `coachip-boot` script), and since bd-1q4z4o
 * on the teacher Home (where WhatsApp's "open the app" link lands; /me/home too): each answer is taken once, by the
 * app's own reader, then gone. Null when there is none (any other page, the Android app, or it
 * was taken already); an answer that was not OK arrives as null too, and the reader then asks as before.
 */
type BootKey = "config" | "me" | "home";
/** `done`: each OK answer, kept by index.html as it arrives (bd-1q4z4o), so a reader can draw with it at once. */
type BootWindow = Window & { __nieteBoot?: Partial<Record<BootKey, Promise<unknown>>> & { done?: Partial<Record<BootKey, unknown>> } };

export function takeBoot<T = unknown>(key: BootKey): Promise<T | null> | null {
  if (typeof window === "undefined") return null;
  const boot = (window as BootWindow).__nieteBoot;
  const read = boot?.[key];
  if (!read) return null;
  delete boot[key];
  // bd-1q4z4o — taken means gone: a later page (Home opened again from the menu) must not draw this load's answer.
  if (boot.done) delete boot.done[key];
  return read as Promise<T | null>;
}

/**
 * bd-1q4z4o — a boot read that has ALREADY answered OK: its value now, synchronously, so the first render can be the
 * final one (the teacher Home draws its tiles at once instead of an outline first). It does not take the read:
 * takeBoot still hands the promise over once. Null while it is on its way, when it was not OK, or when there is none.
 */
export function peekBoot<T = unknown>(key: BootKey): T | null {
  if (typeof window === "undefined") return null;
  const v = (window as BootWindow).__nieteBoot?.done?.[key];
  return v == null ? null : (v as T);
}

/**
 * bd-sex15q.34 (COS 105750) — a read the app starts early, at boot, for the page to take once: This week's
 * /coachip/home, started from the app's first chunk as soon as /config says the switch is on. Taken once if it is
 * at most `maxAgeMs` old; otherwise null, and the page reads as before.
 */
const primed = new Map<string, { at: number; read: Promise<unknown> }>();

export function primeRead<T>(key: string, read: () => Promise<T>): void {
  const p = read();
  p.catch(() => undefined); // a failed prime is the page's to read again, never an unhandled rejection
  primed.set(key, { at: Date.now(), read: p });
}

export function takePrimed<T>(key: string, maxAgeMs = 30_000): Promise<T> | null {
  const p = primed.get(key);
  primed.delete(key);
  return p && Date.now() - p.at <= maxAgeMs ? (p.read as Promise<T>) : null;
}

export function forgetPrimed(key: string): void {
  primed.delete(key);
}

/** Prime only on a literal `features.coachip === true` (fail-closed: an unreadable /config primes nothing). */
export async function primeWhenCoachipOn(readConfig: () => Promise<{ features?: unknown } | null>, prime: () => void): Promise<void> {
  let on = false;
  try {
    const cfg = await readConfig();
    on = (cfg?.features as { coachip?: unknown } | undefined)?.coachip === true;
  } catch {
    on = false;
  }
  if (on) prime();
}
