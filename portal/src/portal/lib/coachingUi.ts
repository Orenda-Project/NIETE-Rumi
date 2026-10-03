import { useAuth } from '../hooks/useAuth';
import { isLeader } from './leaderRole';
import { useNewUi } from './useNewUi';
import { useSelfObservation } from './useSelfObservation';

/**
 * bd-5rz1v.26 — which Coaching screens she gets.
 *
 *   'new'      portal_new_ui AND portal_self_observation, a teacher: the new UI's Coaching
 *              (newui/coaching). Both: every screen of today's flow reads an endpoint that
 *              portal_self_observation guards (requireSelfObservation).
 *   'self'     self-observation only, or a school leader: CoachingHome / LessonPage, unchanged
 *   'legacy'   neither: today's list and report page, unchanged
 *   'loading'  /config (or the user, for the new-UI answer) is still being read
 *
 * Fail-CLOSED, as both flags are: a /config that cannot be read is 'legacy', exactly as before.
 * Same reads as before — useSelfObservation's /config, and useNewUi's (shared with the layout
 * and the menu, and remembered per user so pages do not flash).
 *
 * The auth it returns is the page's own; the page hands it to everything inside
 * (AuthContext.Provider), so the layout does not read the user a second time.
 */
export type CoachingUi = 'loading' | 'new' | 'self' | 'legacy';

export function useCoachingUi(): { ui: CoachingUi; auth: ReturnType<typeof useAuth> } {
  const auth = useAuth();
  const { user, loading } = auth;
  const self = useSelfObservation();
  const newUi = useNewUi(user?.phoneNumber || null, !loading && !!user);

  let ui: CoachingUi;
  if (self === null) ui = 'loading';
  else if (!self) ui = 'legacy';
  else if (user && isLeader(user)) ui = 'self';
  else if (newUi === null && (loading || user)) ui = 'loading';
  else ui = newUi === true && user ? 'new' : 'self';
  return { ui, auth };
}
