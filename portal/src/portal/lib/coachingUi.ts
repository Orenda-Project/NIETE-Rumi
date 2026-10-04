import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { portal } from '../services/api';
import { isLeader } from './leaderRole';

/**
 * bd-5rz1v.26 — which Coaching screens she gets.
 *
 *   'new'      portal_new_ui AND portal_self_observation, a teacher: the new UI's Coaching
 *              (newui/coaching). Both: every screen of today's flow reads an endpoint that
 *              portal_self_observation guards (requireSelfObservation).
 *   'self'     self-observation only, or a school leader: CoachingHome / LessonPage, unchanged
 *   'legacy'   neither: today's list and report page, unchanged
 *   'loading'  /config is still being read (or, with both flags on, the user)
 *
 * ONE /config read gives both flags, as useSelfObservation's one read did: with the new UI off
 * the pages wait for nothing they did not wait for before. Fail-CLOSED, as both flags are: a
 * /config that cannot be read, or a client that throws, is 'legacy', exactly as before.
 *
 * The auth it returns is the page's own; the page hands it to everything inside
 * (AuthContext.Provider), so the layout does not read the user a second time.
 */
export type CoachingUi = 'loading' | 'new' | 'self' | 'legacy';

type Flags = { self: boolean; newUi: boolean };

export function useCoachingUi(): { ui: CoachingUi; auth: ReturnType<typeof useAuth> } {
  const auth = useAuth();
  const { user, loading } = auth;
  const [flags, setFlags] = useState<Flags | null>(null);

  useEffect(() => {
    let live = true;
    // Promise.resolve().then: a config client that throws synchronously is "off", not a crash.
    Promise.resolve().then(() => portal.getConfig())
      .then((cfg) => { if (live) setFlags({ self: cfg?.features?.selfObservation === true, newUi: cfg?.features?.newUi === true }); })
      .catch(() => { if (live) setFlags({ self: false, newUi: false }); });
    return () => { live = false; };
  }, []);

  let ui: CoachingUi;
  if (!flags) ui = 'loading';
  else if (!flags.self) ui = 'legacy';
  else if (!flags.newUi) ui = 'self';
  else if (loading && !user) ui = 'loading';
  else ui = user && !isLeader(user) ? 'new' : 'self';
  return { ui, auth };
}
