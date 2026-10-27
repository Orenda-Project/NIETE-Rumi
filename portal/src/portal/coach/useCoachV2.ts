import { useEffect, useState, useSyncExternalStore } from "react";
import { resolveRole } from "../lib/leaderRole";
import { forgetConfig, readConfigShared } from "../lib/useNewUi";

/**
 * bd-o15qnr — is the coach app v2 (portal_coach_v2) on for this user?
 *
 * Read like useNewUi: null while /config is read, then true only for a real
 * `true`. Fail-CLOSED: an unreadable config, or a client that throws, is off,
 * and every page renders exactly what it rendered before.
 *
 * Like useNewUi it remembers the last answer for the SAME user (memory only,
 * never stored), so the menu does not flash the old items on every tap. A
 * fresh read still happens on every mount, and an "off" replaces an "on".
 *
 * ONE answer, held by every reader at once. The app-wide guard (CoachAppGuard)
 * is mounted once per visit and the page gates (CoachGate) on every page; they
 * route against each other — the guard sends a v2 coach from a page that is not
 * ready to the Training Library, the Library's gate sends anyone who is not a v2
 * coach to /portal/leader. When each held its own copy, a later read that said
 * "off" (the flag turned off, or one failed /config read, which is off) reached
 * the page gates but not the guard, and the two bounced the coach between those two
 * pages without end. Now a fresh answer reaches every mounted reader in the same
 * render, so they can never disagree.
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

/** Shares the layout's and the navigation's one /config read (lib/useNewUi). */
function readCoachV2(): Promise<boolean> {
  return readConfigShared().then((cfg) => cfg?.features?.coachV2 === true).catch(() => false);
}

function rememberedFor(userKey?: string | null): boolean | null {
  return userKey && remembered && remembered.userKey === userKey ? remembered.on : null;
}

/**
 * @param userKey whose answer to remember (her phone number; memory only)
 * @param ready   false while the caller cannot ask yet
 */
export function useCoachV2(userKey?: string | null, ready = true): boolean | null {
  // With a key: the one remembered answer for that user, the same in every reader.
  const shared = useSyncExternalStore(subscribe, () => rememberedFor(userKey), () => rememberedFor(userKey));
  // Without a key nothing is remembered or shared: this reader keeps its own answer, as before.
  const [own, setOwn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    readCoachV2().then((value) => {
      if (userKey) remember({ userKey, on: value });
      else if (live) setOwn(value);
    });
    return () => { live = false; };
  }, [userKey, ready]);

  return userKey ? shared : own;
}

/** v2 is for coaches only: the flag on AND role = coach. Loading or unknown is no. */
export function isCoachV2For(user: { role?: string | null } | null | undefined, flag: boolean | null): boolean {
  return flag === true && resolveRole(user) === "coach";
}

/** Tests only: forget the remembered answer. */
export function resetCoachV2Memory(): void {
  remember(null);
  forgetConfig();
}
