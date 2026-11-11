import type { TeacherRoute } from '../routes';
import { lazyPage as page } from '@/lib/lazyPage';
import { PrincipalObserve } from './observe';

// bd-33wxxi.4 — each page is its own chunk (lib/lazyPage). The observe and observation pages are the coach app's own,
// drawn inside PrincipalObserve (the principal's visit source and links; a non-principal is sent to Observations).
const PickTeacher = page(() => import('./PickTeacher').then((m) => ({ default: m.PickTeacher })));
const CoachVisit = page(() => import('../../coach/pages/CoachVisit'));
const CoachCheckSend = page(() => import('../../coach/pages/CoachCheckSend'));
const CoachRecord = page(() => import('../../coach/pages/CoachRecord'));
const CoachAttach = page(() => import('../../coach/pages/CoachAttach'));
const CoachSending = page(() => import('../../coach/pages/CoachSending'));
const CoachObservation = page(() => import('../../coach/pages/CoachObservation'));
const CoachFeedbackForm = page(() => import('../../coach/reports/FeedbackForm'));
const CoachDebrief = page(() => import('../../coach/reports/Debrief'));
const CoachYourFeedback = page(() => import('../../coach/reports/YourFeedback'));
const CoachSendReport = page(() => import('../../coach/reports/SendReport'));

const P = '/portal/teacher/principal';
const as = (el: JSX.Element) => <PrincipalObserve>{el}</PrincipalObserve>;

/**
 * bd-33wxxi.4 — the principal app's observe screens (#55 P3), under the teacher app (TeacherGate). Observations itself
 * stays /portal/teacher/observations (its page hands over to PrincipalObservations for a principal on the app).
 *
 *   /pick                                Pick the teacher (her own school's teachers)
 *   /visit/:id                           bd-33wxxi.9.3 — the picked teacher's page: the coach's visit screen (:id = her teacherExtId)
 *   /observe/:id                         Check and send for that teacher (:id = her teacherExtId; no visit)
 *   /observe/:id/record | attach | sending
 *   /observation/:id (+ /form, /debrief, /feedback, /send)   one observation she made
 */
const routes: TeacherRoute[] = [
  { path: `${P}/pick`, element: as(<PickTeacher />) },
  { path: `${P}/visit/:id`, element: as(<CoachVisit />) },
  { path: `${P}/observe/:id`, element: as(<CoachCheckSend />) },
  { path: `${P}/observe/:id/record`, element: as(<CoachRecord />) },
  { path: `${P}/observe/:id/attach`, element: as(<CoachAttach />) },
  { path: `${P}/observe/:id/sending`, element: as(<CoachSending />) },
  { path: `${P}/observation/:id`, element: as(<CoachObservation />) },
  { path: `${P}/observation/:id/form`, element: as(<CoachFeedbackForm />) },
  { path: `${P}/observation/:id/debrief`, element: as(<CoachDebrief />) },
  { path: `${P}/observation/:id/feedback`, element: as(<CoachYourFeedback />) },
  { path: `${P}/observation/:id/send`, element: as(<CoachSendReport />) },
];

export default routes;
