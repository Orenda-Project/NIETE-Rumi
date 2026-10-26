import { useEffect, useState } from "react";
import { readConfigShared, forgetConfig } from "../../lib/useNewUi";

/**
 * bd-sex15q.15 — is COACHIP (portal_coachip, per user) on for this coach? Read like useCoachV2: null while /config is
 * read, then true only for a literal `true` in `features.coachip` (m-api's /config boolean). Fail-CLOSED: an unreadable
 * config, a missing key or a client that throws is off, and the coach app is exactly what it was (B8).
 *
 * Remembers the last answer for the SAME user (memory only) so the menu does not flash on every tap.
 */

let remembered: { userKey: string; on: boolean } | null = null;

function readCoachip(): Promise<boolean> {
  return readConfigShared()
    .then((cfg) => (cfg?.features as { coachip?: unknown } | undefined)?.coachip === true)
    .catch(() => false);
}

function rememberedFor(userKey?: string | null): boolean | null {
  return userKey && remembered && remembered.userKey === userKey ? remembered.on : null;
}

/**
 * @param userKey whose answer to remember (the phone number; memory only)
 * @param ready   false while the caller cannot ask yet (not a coach, still signing in)
 */
export function useCoachip(userKey?: string | null, ready = true): boolean | null {
  const [on, setOn] = useState<boolean | null>(() => rememberedFor(userKey));

  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    readCoachip().then((value) => {
      if (userKey) remembered = { userKey, on: value };
      if (live) setOn(value);
    });
    return () => { live = false; };
  }, [userKey, ready]);

  return ready ? on : false;
}

/** Tests only. */
export function resetCoachipMemory(): void {
  remembered = null;
  forgetConfig();
}
