import { useEffect, useState } from 'react';
import { portal } from '../services/api';

/**
 * Is the coach's Learning assessment on for this user? null while /config is
 * read, then true/false. Fail-CLOSED, like useChildTest: an unreadable config is "off".
 */
export function useChildTestSa(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => portal.getConfig())
      .then((cfg) => { if (live) setOn(cfg?.features?.childTestSa === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}
