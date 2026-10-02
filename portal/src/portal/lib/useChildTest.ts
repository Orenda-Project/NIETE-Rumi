import { useEffect, useState } from 'react';
import { portal } from '../services/api';

/**
 * bd-s1oo0.7 — is the child test in the coach app on for this user?
 * null while /config is read, then true/false. Fail-CLOSED, like
 * useSelfObservation: an unreadable config is "off".
 */
export function useChildTest(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => portal.getConfig())
      .then((cfg) => { if (live) setOn(cfg?.features?.childTest === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}
