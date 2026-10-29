import { useEffect, useState, useSyncExternalStore } from "react";
import { forgetConfig, readConfigShared } from "../../lib/useNewUi";

/**
 * The School card switch (app_settings `portal_coach_school_card`, served as `features.schoolCard` in /config).
 *
 * Read like useCoachV2 and useCoachip: null while /config is read, then true ONLY for a literal `true`. Fail-CLOSED: an
 * unreadable config, a missing key, `"true"` or a client that throws is off, and the coach app is exactly what it was.
 *
 * ONE answer shared by every reader (the guard, the menu and the pages), as in useCoachV2: if the guard and a page held
 * different answers they could send the coach between two pages without end. A fresh read happens on every mount and an
 * "off" replaces an "on" for every mounted reader in the same render. Memory only, never stored.
 */

type Remembered = { userKey: string; on: boolean };

let remembered: Remembered | null = null;
const listeners = new Set<() => void>();

function remember(next: Remembered | null): void {
  remembered = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The literal-true rule, on its own so it can be tested without a component. */
export function schoolCardOn(cfg: unknown): boolean {
  const features = (cfg as { features?: unknown } | null | undefined)?.features;
  return !!features && typeof features === "object" && (features as { schoolCard?: unknown }).schoolCard === true;
}

function readSchoolCard(): Promise<boolean> {
  return readConfigShared().then(schoolCardOn).catch(() => false);
}

function rememberedFor(userKey?: string | null): boolean | null {
  return userKey && remembered && remembered.userKey === userKey ? remembered.on : null;
}

/**
 * @param userKey whose answer to remember (her phone number; memory only)
 * @param ready   false while the caller cannot ask yet (not a coach, still signing in): then the answer is false
 */
export function useSchoolCard(userKey?: string | null, ready = true): boolean | null {
  const shared = useSyncExternalStore(subscribe, () => rememberedFor(userKey), () => rememberedFor(userKey));
  const [own, setOwn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    readSchoolCard().then((value) => {
      if (userKey) remember({ userKey, on: value });
      else if (live) setOwn(value);
    });
    return () => { live = false; };
  }, [userKey, ready]);

  if (!ready) return false;
  return userKey ? shared : own;
}

/** Tests only: forget the remembered answer and the shared /config read. */
export function resetSchoolCardMemory(): void {
  remember(null);
  forgetConfig();
}
