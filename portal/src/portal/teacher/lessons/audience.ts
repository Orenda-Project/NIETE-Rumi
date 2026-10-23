import { useContext } from 'react';
import { AuthContext } from '../../hooks/authContext';
import { isLeader, resolveRole } from '../../lib/leaderRole';
import { isTeacherV2For, useTeacherV2 } from '../useTeacherV2';

/**
 * bd-4joiqz — who is reading the Lesson Plans pages: a teacher, or a LEADER.
 *
 * "why can't a coach see LPs in their IAB? Shouldnt we make them available?" (operator, 22 Oct 2026). The leader
 * family (coach, principal, AEO, supervisor, school leader) reads the same pages a teacher uses (TeacherGate lets
 * them through on the routes marked `leaders`). A principal ON the teacher app is a teacher here, exactly as before
 * (useTeacherV2: she gets the teacher app as a teacher does). Everyone else in the family is a leader.
 *
 * What a leader does not see, because it is the teacher's own: Start DC observation, Thing to try and Send on
 * WhatsApp on the viewer; Recent and Being made on Lesson Plans (her history). FLN's Share / Send to teacher stay as
 * they are. What the server records for a leader's open is the server's call (it reads the role
 * itself, dashboard/services/lp-reader.service.js): nothing here is trusted for that.
 *
 * Read from the app's one user (AuthContext, like CoachAppGuard): no user is a teacher, so a page outside the
 * provider is exactly today's.
 */
export function isLessonsLeader(user: { role?: string | null } | null | undefined, teacherV2: boolean | null): boolean {
  return isLeader(user) && !isTeacherV2For(user, teacherV2);
}

export function useLessonsLeader(): boolean {
  const shared = useContext(AuthContext);
  const user = shared && !shared.loading ? shared.user : null;
  // Only a principal's answer depends on the flag; TeacherGate has read it already (remembered for her phone).
  const flag = useTeacherV2(user?.phoneNumber || null, resolveRole(user) === 'principal');
  return isLessonsLeader(user, flag);
}
