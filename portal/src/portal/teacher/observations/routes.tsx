import type { TeacherRoute } from '../routes';
import { OBS_HOME, OBS_REPORT } from './paths';
import { lazyPage as page } from '@/lib/lazyPage';

// bd-sex15q.34 — each page is its own chunk (lib/lazyPage), so the teacher app is not in every first open.
const ObservationReportPage = page(() => import('./ObservationsHome').then((m) => ({ default: m.ObservationReportPage })));
const ObservationsHomePage = page(() => import('./ObservationsHome').then((m) => ({ default: m.ObservationsHomePage })));

/**
 * bd-fmf24g.4 — the teacher v2 Observations pages (flag-gated by App's TeacherGate). The main page is
 * registered, so every link to Observations comes here for a teacher with portal_teacher_v2; a coach
 * visit's report is the shared report page, with Observations as its way back (named at render, in the
 * page's language — bd-fmf24g.13.2).
 */
const routes: TeacherRoute[] = [
  { path: OBS_HOME, element: <ObservationsHomePage /> },
  { path: OBS_REPORT, element: <ObservationReportPage /> },
];

export default routes;
