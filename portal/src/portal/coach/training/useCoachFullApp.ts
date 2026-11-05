import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { forgetConfig, readConfigShared } from "../../lib/useNewUi";
import { AuthContext } from "../../hooks/authContext";
import { coachFeatureReady, type CoachFeature } from "./appReady";

/**
 * bd-jjcofw — the full coach app switch (app_settings `portal_coach_full_app`, served as `features.coachFullApp` in
 * /config): Schedule and Observe open for a listed tester (appReady.ts coachReadyFor).
 *
 * A copy of useSchoolCard's rules: null while /config is read, then true ONLY for a literal `true`. Fail-CLOSED: an
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
export function coachFullAppOn(cfg: unknown): boolean {
  const features = (cfg as { features?: unknown } | null | undefined)?.features;
  return !!features && typeof features === "object" && (features as { coachFullApp?: unknown }).coachFullApp === true;
}

function readCoachFullApp(): Promise<boolean> {
  return readConfigShared().then(coachFullAppOn).catch(() => false);
}

function rememberedFor(userKey?: string | null): boolean | null {
  return userKey && remembered && remembered.userKey === userKey ? remembered.on : null;
}

/**
 * @param userKey whose answer to remember (her phone number; memory only)
 * @param ready   false while the caller cannot ask yet (not a coach, still signing in): then the answer is false
 */
export function useCoachFullApp(userKey?: string | null, ready = true): boolean | null {
  const shared = useSyncExternalStore(subscribe, () => rememberedFor(userKey), () => rememberedFor(userKey));
  const [own, setOwn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    readCoachFullApp().then((value) => {
      if (userKey) remember({ userKey, on: value });
      else if (live) setOwn(value);
    });
    return () => { live = false; };
  }, [userKey, ready]);

  if (!ready) return false;
  return userKey ? shared : own;
}

/**
 * Is this coach feature showing for the signed-in coach? coachFeatureReady with her full coach app switch: a page uses it
 * to leave out a link into a feature the guard would turn away (Schedule a visit, a HITL report, the pending banner).
 * While the switch is read, or off, exactly coachFeatureReady(feature).
 */
export function useCoachFeatureReady(feature: CoachFeature): boolean {
  const userKey = useContext(AuthContext)?.user?.phoneNumber || null;
  return coachFeatureReady(feature, useCoachFullApp(userKey));
}

/** Tests only: forget the remembered answer and the shared /config read. */
export function resetCoachFullAppMemory(): void {
  remember(null);
  forgetConfig();
}
