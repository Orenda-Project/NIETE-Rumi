import { useEffect, useState, useSyncExternalStore } from 'react';
import { readConfigShared } from '../../lib/useNewUi';
import { useLang } from '../i18n';
import { isSeenLocally, loadHelp, subscribeSeen, type HelpData } from './api';

/**
 * bd-ik5e8j.4 — the help entry's state for one screen: is the switch on for her (GET /config features.helpVideos, the
 * shared cached read; fail-closed), her videos in the page's language, and whether she has opened one before.
 * `on` is null while /config is read; nothing is fetched from /help unless it is true.
 */
/** Only the switch (GET /config features.helpVideos): null while read, then true only for a real `true`. */
export function useHelpSwitch(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readConfigShared()
      .then((cfg) => { if (live) setOn(cfg?.features?.helpVideos === true); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

export function useHelp(): { on: boolean | null; data: HelpData | null; seen: boolean } {
  const lang = useLang();
  const on = useHelpSwitch();
  const [data, setData] = useState<HelpData | null>(null);
  const seenHere = useSyncExternalStore(subscribeSeen, isSeenLocally, isSeenLocally);

  useEffect(() => {
    if (on !== true) return undefined;
    let live = true;
    void loadHelp(lang).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [on, lang]);

  return { on, data, seen: seenHere || data?.seen === true };
}

/** prefers-reduced-motion: reduce → no animation anywhere in the help entry. */
export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [reduced, setReduced] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}
