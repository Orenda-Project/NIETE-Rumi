import { useEffect, useState } from "react";
import { peekConfig, readConfigShared } from "../../lib/useNewUi";
import { principalOf, type RoleUserLike } from "../../lib/leaderRole";

/**
 * bd-33wxxi.2 — is this user a principal on the principal app? Her role is principal (principalOf) AND the server says
 * so for her (`/config` features.principalApp, portal_principal_app, read from the one shared /config read).
 * Fail-CLOSED: while /config is read, when it cannot be read, or for anything but a real `true`, the answer is no and
 * the teacher app draws exactly what it draws for a teacher.
 */
export function usePrincipalApp(user: RoleUserLike | null | undefined): boolean {
  return usePrincipalAppState(user) === true;
}

/**
 * bd-33wxxi.4 — the same answer, with `null` while /config has not answered yet (a page that must not redirect on a
 * guess). Not a principal: false at once. A failed read: false.
 */
export function usePrincipalAppState(user: RoleUserLike | null | undefined): boolean | null {
  const principal = principalOf(user);
  const peeked = peekConfig();
  const [on, setOn] = useState<boolean | null>(() => (!principal ? false : peeked ? peeked.features?.principalApp === true : null));
  useEffect(() => {
    if (!principal) { setOn(false); return undefined; }
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.principalApp === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, [principal]);
  return principal ? on : false;
}
