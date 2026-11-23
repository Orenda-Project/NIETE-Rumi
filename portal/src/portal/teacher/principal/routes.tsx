import type { TeacherRoute } from '../routes';
import { lazyPage as page } from '@/lib/lazyPage';
import { PrincipalObserve } from './observe';

// bd-33wxxi.4 — each page is its own chunk (lib/lazyPage). The observe and observation pages are the coach app's own,
// drawn inside PrincipalObserve (the principal's visit source and links; a non-principal is sent to Observations).
const PickTeacher = page(() => import('./PickTeacher').then((m) => ({ default: m.PickTeacher })));
// bd-31ziu8 — principals book visits as coaches do: the day and time, then My schedule (the coach's screens).
const PrincipalNewVisit = page(() => import('./NewVisit').then((m) => ({ default: m.PrincipalNewVisit })));
const PrincipalSchedule = page(() => import('./Schedule').then((m) => ({ default: m.PrincipalSchedule })));
const CoachVisit = page(() => import('../../coach/pages/CoachVisit'));
const CoachCheckSend = page(() => import('../../coach/pages/CoachCheckSend'));
const CoachRecord = page(() => import('../../coach/pages/CoachRecord'));
const CoachAttach = page(() => import('../../coach/pages/CoachAttach'));
const CoachSending = page(() => import('../../coach/pages/CoachSending'));
const CoachObservation = page(() => import('../../coach/pages/CoachObservation'));
const CoachFeedbackForm = page(() => import('../../coach/reports/FeedbackForm'));
const CoachDebrief = page(() => import('../../coach/reports/Debrief'));
const CoachYourFeedback = page(() => import('../../coach/reports/YourFeedback'));
// bd-o15qnr.28 (v7) — with the v6/v7 switch on for her, "Your feedback" is the one feedback page (the debrief report's).
const PrincipalFeedbackRoute = page(() => import('./FeedbackRoute').then((m) => ({ default: m.PrincipalFeedbackRoute })));
const CoachSendReport = page(() => import('../../coach/reports/SendReport'));
// bd-o15qnr.28 (v6/v7) — My observations: every observation she made and her own lessons (Observe's History).
const PrincipalMyObservations = page(() => import('./ObserveV6').then((m) => ({ default: m.PrincipalMyObservations })));

const P = '/portal/teacher/principal';
const as = (el: JSX.Element) => <PrincipalObserve>{el}</PrincipalObserve>;

/**
 * bd-33wxxi.4 — the principal app's observe screens (#55 P3), under the teacher app (TeacherGate). Observations itself
 * stays /portal/teacher/observations (its page hands over to PrincipalObservations for a principal on the app).
 *
 *   /pick                                Pick the teacher (her own school's teachers)
 *   /new-visit?teacher=:ext              bd-31ziu8 — book a day and time for that teacher, as a coach does
 *   /schedule                            bd-31ziu8 — My schedule (the coach's), each visit opening /visit/:ext
 *   /observations                        bd-o15qnr.28 — My observations (the v6/v7 switch; off → Observations)
 *   /visit/:id                           bd-33wxxi.9.3 — the picked teacher's page: the coach's visit screen (:id = her teacherExtId)
 *   /observe/:id                         Check and send for that teacher (:id = her teacherExtId; no visit)
 *   /observe/:id/record | attach | sending
 *   /observation/:id (+ /form, /debrief, /feedback, /send)   one observation she made
 */
const routes: TeacherRoute[] = [
  { path: `${P}/pick`, element: as(<PickTeacher />) },
  { path: `${P}/new-visit`, element: as(<PrincipalNewVisit />) },
  { path: `${P}/schedule`, element: as(<PrincipalSchedule />) },
  { path: `${P}/observations`, element: as(<PrincipalMyObservations />) },
  { path: `${P}/visit/:id`, element: as(<CoachVisit />) },
  { path: `${P}/observe/:id`, element: as(<CoachCheckSend />) },
  { path: `${P}/observe/:id/record`, element: as(<CoachRecord />) },
  { path: `${P}/observe/:id/attach`, element: as(<CoachAttach />) },
  { path: `${P}/observe/:id/sending`, element: as(<CoachSending />) },
  { path: `${P}/observation/:id`, element: as(<CoachObservation />) },
  { path: `${P}/observation/:id/form`, element: as(<CoachFeedbackForm />) },
  { path: `${P}/observation/:id/debrief`, element: as(<CoachDebrief />) },
  { path: `${P}/observation/:id/feedback`, element: as(<PrincipalFeedbackRoute off={<CoachYourFeedback />} />) },
  { path: `${P}/observation/:id/send`, element: as(<CoachSendReport />) },
];

export default routes;
