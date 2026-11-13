import { useEffect, useState } from 'react';
import { readConfigShared } from '../../../lib/useNewUi';

/**
 * bd-snkn32 — is "Make my own" on for her (GET /config features.lpMakeOwn; the shared, cached read, so no extra
 * request). Its own tiny file so the chapter page can ask without loading the flow's code: the row itself is a lazy
 * chunk, fetched only when this says yes.
 */
/** null while /config is read, then true only for a real `true` (fail-closed). */
export function useLpMakeOwn(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.lpMakeOwn === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

