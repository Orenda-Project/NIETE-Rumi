import { useEffect, useState } from 'react';
import { portal } from '../services/api';

/**
 * bd-3bvfj / bd-5rz1v — is teacher self-observation on for her?
 *
 * null while /config is being read, then true or false. Fail-CLOSED: a config
 * that cannot be read, or a client that throws, is "off" — the pages then show
 * exactly what every teacher had before.
 */
export function useSelfObservation(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    // Promise.resolve().then: a config client that throws synchronously must
    // not take the page down — it is just "off".
    Promise.resolve().then(() => portal.getConfig())
      .then((cfg) => { if (live) setOn(cfg?.features?.selfObservation === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}
