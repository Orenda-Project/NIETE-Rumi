import { useEffect, useState } from "react";
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
 */

let remembered: { userKey: string; on: boolean } | null = null;

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
  const [on, setOn] = useState<boolean | null>(() => rememberedFor(userKey));

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    readCoachV2().then((value) => {
      if (userKey) remembered = { userKey, on: value };
      if (live) setOn(value);
    });
    return () => { live = false; };
  }, [userKey, ready]);

  return on;
}

/** v2 is for coaches only: the flag on AND role = coach. Loading or unknown is no. */
export function isCoachV2For(user: { role?: string | null } | null | undefined, flag: boolean | null): boolean {
  return flag === true && resolveRole(user) === "coach";
}

/** Tests only: forget the remembered answer. */
export function resetCoachV2Memory(): void {
  remembered = null;
  forgetConfig();
}
