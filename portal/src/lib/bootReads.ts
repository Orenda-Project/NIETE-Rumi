/**
 * bd-sex15q.34 — what index.html asked for at boot on a COACHIP page (the `coachip-boot` script): each answer is
 * taken once, by the app's own reader, then gone. Null when there is none (any other page, the Android app, or it
 * was taken already); an answer that was not OK arrives as null too, and the reader then asks as before.
 */
type BootKey = "config" | "me";
type BootWindow = Window & { __nieteBoot?: Partial<Record<BootKey, Promise<unknown>>> };

export function takeBoot<T = unknown>(key: BootKey): Promise<T | null> | null {
  if (typeof window === "undefined") return null;
  const boot = (window as BootWindow).__nieteBoot;
  const read = boot?.[key];
  if (!read) return null;
  delete boot[key];
  return read as Promise<T | null>;
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
