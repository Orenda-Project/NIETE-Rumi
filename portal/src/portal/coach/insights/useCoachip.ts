import { useEffect, useState } from "react";
import { readConfigShared, forgetConfig } from "../../lib/useNewUi";
import { coachip as coachipApi } from "./api";

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

/**
 * fix-r5 (SPEC v2.1 §11.6, dual-role users): is `features.coachipRm` a literal `true` in /config? Fail-closed like
 * useCoachip (null while reading, false on any error or missing key). Reads /config only: no /coachip/ request.
 */
export function useCoachipRm(ready = true): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    readConfigShared()
      .then((cfg) => (cfg?.features as { coachipRm?: unknown } | undefined)?.coachipRm === true)
      .catch(() => false)
      .then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, [ready]);
  return ready ? on : false;
}

/**
 * fix-r5 s5: for a dual (both switches on), does the RM also coach a school of their sector? `/coachip/me`
 * rm.coachesHere, read only when `ask` is true (both switches literal true), so with either switch off no /coachip/
 * request is made (B8). null while reading; any error, a null rm or a missing key is `true` (keep This week).
 */
export function useRmCoachesHere(ask: boolean): boolean | null {
  const [here, setHere] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ask) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => coachipApi.me())
      .then((m) => m?.rm?.coachesHere !== false)
      .catch(() => true)
      .then((value) => { if (live) setHere(value); });
    return () => { live = false; };
  }, [ask]);
  return ask ? here : true;
}

/**
 * fix-r5 s6 (b), GO_PACKAGE v5 §0.4 b: may this coach see "Show name" (the operator's ruling 1, decode for their own
 * teachers)? Only for a literal `features.coachipDecode === true` in /config AND a literal `decode: true` from
 * `/coachip/me` (decode on and the caller is a coach). With the /config switch off, no /coachip/ request is made.
 * Any error or missing key is false. Not remembered: asked once per step card.
 */
export function useDecode(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => (cfg?.features as { coachipDecode?: unknown } | undefined)?.coachipDecode === true)
      .then((switched) => (switched ? coachipApi.me().then((m) => m?.decode === true) : false))
      .catch(() => false)
      .then((value) => { if (live) setOn(value); });
    return () => { live = false; };
  }, []);
  return on;
}

/** Tests only. */
export function resetCoachipMemory(): void {
  remembered = null;
  forgetConfig();
}
