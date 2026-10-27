import type { TeacherRoute } from '../routes';
import { COACHING_ALL, COACHING_HOME, COACHING_NEW, COACHING_REPORT, COACHING_SEND } from './paths';
import { lazyPage as page } from '@/lib/lazyPage';

// bd-sex15q.34 — each page is its own chunk (lib/lazyPage), so the teacher app is not in every first open.
const CoachingAllPage = page(() => import('./CoachingAll').then((m) => ({ default: m.CoachingAllPage })));
const CoachingHomePage = page(() => import('./CoachingHome').then((m) => ({ default: m.CoachingHomePage })));
const NewObservationPage = page(() => import('./NewObservation').then((m) => ({ default: m.NewObservationPage })));
const ReportPage = page(() => import('./ReportPage').then((m) => ({ default: m.ReportPage })));
const SendPage = page(() => import('./SendPage').then((m) => ({ default: m.SendPage })));

/**
 * bd-fmf24g.4 — the teacher v2 Digital Coaching pages (each one flag-gated by App's TeacherGate). The
 * main page is registered, so every link to Digital Coaching (the bottom menu, Home's tile, More) comes
 * here for a teacher with portal_teacher_v2 (teacher/paths resolveTeacherPath); flag off, today's page.
 */
const routes: TeacherRoute[] = [
  { path: COACHING_HOME, element: <CoachingHomePage /> },
  { path: COACHING_NEW, element: <NewObservationPage /> },
  { path: COACHING_SEND, element: <SendPage /> },
  { path: COACHING_REPORT, element: <ReportPage /> },
  { path: COACHING_ALL, element: <CoachingAllPage /> },
];

export default routes;
