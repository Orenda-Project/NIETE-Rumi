import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { forgetConfig, readConfigShared } from "../../lib/useNewUi";
import { AuthContext } from "../../hooks/authContext";

/**
 * bd-o15qnr.26 — the coach visit flow v2 switch (app_settings `portal_coach_flow_v2`, served as `features.coachFlowV2` in
 * /config, only with the coach app v2 AND the full coach app on for her): Schedule becomes the one open list of her visits
 * (Overdue · Today · Coming up · Earlier, Start / Reschedule / Cancel visit on each row), the menu's Observe becomes
 * Observations (her observations), New visit gets the teaching-level chips and the Home gets the Today card.
 *
 * useCoachFullApp's rules, copied: null while /config is read, then true ONLY for a literal `true`. Fail-CLOSED: an
 * unreadable config, a missing key, `"true"` or a client that throws is off, and every coach screen is exactly what it
 * was. ONE answer shared by every reader (the routes, the menu, the Home and New visit), so a route and the menu can
 * never disagree. Memory only, never stored.
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
export function coachFlowV2On(cfg: unknown): boolean {
  const features = (cfg as { features?: unknown } | null | undefined)?.features;
  return !!features && typeof features === "object" && (features as { coachFlowV2?: unknown }).coachFlowV2 === true;
}

function readCoachFlowV2(): Promise<boolean> {
  return readConfigShared().then(coachFlowV2On).catch(() => false);
}

function rememberedFor(userKey?: string | null): boolean | null {
  return userKey && remembered && remembered.userKey === userKey ? remembered.on : null;
}

/**
 * @param userKey whose answer to remember (her phone number; memory only)
 * @param ready   false while the caller cannot ask yet (not a coach, still signing in): then the answer is false
 */
export function useCoachFlowV2(userKey?: string | null, ready = true): boolean | null {
  const shared = useSyncExternalStore(subscribe, () => rememberedFor(userKey), () => rememberedFor(userKey));
  const [own, setOwn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    readCoachFlowV2().then((value) => {
      if (userKey) remember({ userKey, on: value });
      else if (live) setOwn(value);
    });
    return () => { live = false; };
  }, [userKey, ready]);

  if (!ready) return false;
  return userKey ? shared : own;
}

/** The signed-in coach's answer (her phone number from the session): null while read, then true or false. */
export function useFlowV2(): boolean | null {
  const userKey = useContext(AuthContext)?.user?.phoneNumber || null;
  return useCoachFlowV2(userKey);
}

/**
 * bd-o15qnr.27 (queue #204, v6) — the screens a coach and a principal share (Schedule for Now / Later, the recording that
 * keeps going while she moves round the app): on for a coach on this switch (`coachFlowV2`) or a principal on the
 * principal app the same switch names (`principalFlowV2`, the operator 20 Nov: "For the Coach and the Principal both").
 * Same literal-true, fail-closed rule; null while /config is read (the shared read, so no extra request).
 */
export function flowV6On(cfg: unknown): boolean {
  const features = (cfg as { features?: unknown } | null | undefined)?.features;
  if (!features || typeof features !== "object") return false;
  const f = features as { coachFlowV2?: unknown; principalFlowV2?: unknown };
  return f.coachFlowV2 === true || f.principalFlowV2 === true;
}

export function useFlowV6(): boolean | null {
  const userKey = useContext(AuthContext)?.user?.phoneNumber || null;
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared().then(flowV6On).catch(() => false).then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, [userKey]);
  return on;
}

/** Tests only: forget the remembered answer and the shared /config read. */
export function resetCoachFlowV2Memory(): void {
  remember(null);
  forgetConfig();
}
