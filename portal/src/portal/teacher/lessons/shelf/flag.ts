import { useEffect, useState } from 'react';
import { readConfigShared } from '../../../lib/useNewUi';
import { LESSONS_HOME } from '../paths';

/**
 * bd-snkn32.42 — the small part of "Made by a teacher" the always-loaded code needs: its two switches (GET /config
 * features.lpOwnShelf and features.lpOwnReviewer; the shared, cached read, so no extra request) and the check page's
 * address. Its own tiny file, like own/flag.ts, so the chapter page and the route table never load the shelf's code.
 */

/** The staff check before a teacher's plan is listed. */
export const LESSONS_CHECK = `${LESSONS_HOME}/check`;

type Feature = 'lpOwnShelf' | 'lpOwnReviewer';
function useFeature(name: Feature): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.[name] === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, [name]);
  return on;
}
/** null while /config is read, then true only for a real `true` (fail-closed). */
export const useLpOwnShelf = () => useFeature('lpOwnShelf');
export const useLpOwnReviewer = () => useFeature('lpOwnReviewer');
