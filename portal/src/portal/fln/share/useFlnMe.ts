/**
 * bd-t7zk3t.12 — what this session may see, asked of the server on EVERY mount (never cached in the client: a coach
 * and a teacher can share one phone, and the Share bar must follow whoever is signed in now — DESIGN v2 ruling 8).
 * `null` while asking; `false` for "no" (share off, 401, 404, an error, the network).
 */
import { useEffect, useState } from 'react';
import { shareApi, type FlnMe } from './api';

export type MeState = FlnMe | false | null;

export function useFlnMe(): MeState {
  const [me, setMe] = useState<MeState>(null);
  useEffect(() => {
    let alive = true;
    void shareApi.me().then((r) => {
      if (!alive) return;
      setMe(r.ok && r.data && typeof r.data === 'object' ? r.data : false);
    });
    return () => { alive = false; };
  }, []);
  return me;
}

/** The leader's chrome language from /me (EN until known). */
export function langOf(me: MeState): 'en' | 'ur' {
  return me && me.ui_lang === 'ur' ? 'ur' : 'en';
}
