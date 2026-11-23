import { useEffect, useState } from "react";
import { peekConfig, readConfigShared } from "../../lib/useNewUi";
import { principalOf, type RoleUserLike } from "../../lib/leaderRole";

/**
 * A principal's two answers from the one shared /config read (bd-33wxxi.11, queue #236 option B; the operator, 23 Nov:
 * "principals should get the new portal without the HITL because that is not ready yet"):
 *
 *   principalApp       the principal Home: every principal (users.role principal), no switch — her Principal chip,
 *                      My school card, her tiles and bar, Analytics → My school
 *   principalObserve   observing in the app: portal_principal_app names her — the Observations tile, the Observe item,
 *                      her observe screens (/portal/teacher/principal/…), the v6 Home
 *
 * Both need her role to be principal (principalOf) AND the server's real `true`. Fail-CLOSED: while /config is read,
 * when it cannot be read, or for anything but a real `true`, the answer is no.
 */
type PrincipalFeature = "principalApp" | "principalObserve";

function usePrincipalFeature(user: RoleUserLike | null | undefined, feature: PrincipalFeature): boolean | null {
  const principal = principalOf(user);
  const peeked = peekConfig();
  const [on, setOn] = useState<boolean | null>(() => (!principal ? false : peeked ? peeked.features?.[feature] === true : null));
  useEffect(() => {
    if (!principal) { setOn(false); return undefined; }
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.[feature] === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, [principal, feature]);
  return principal ? on : false;
}

/** bd-33wxxi.2 — is this user a principal with the principal Home? (every principal since bd-33wxxi.11) */
export function usePrincipalApp(user: RoleUserLike | null | undefined): boolean {
  return usePrincipalAppState(user) === true;
}

/**
 * bd-33wxxi.4 — the same answer, with `null` while /config has not answered yet (a page that must not redirect on a
 * guess). Not a principal: false at once. A failed read: false.
 */
export function usePrincipalAppState(user: RoleUserLike | null | undefined): boolean | null {
  return usePrincipalFeature(user, "principalApp");
}

/** bd-33wxxi.11 — may this principal observe in the app? (portal_principal_app names her) */
export function usePrincipalObserve(user: RoleUserLike | null | undefined): boolean {
  return usePrincipalObserveState(user) === true;
}

/** bd-33wxxi.11 — the same, with `null` while /config has not answered yet. Not a principal: false at once. */
export function usePrincipalObserveState(user: RoleUserLike | null | undefined): boolean | null {
  return usePrincipalFeature(user, "principalObserve");
}
