import type { TeacherRoute } from '../routes';
import { AnalyticsPage } from './AnalyticsPage';
import { ANALYTICS_HOME, ANALYTICS_TEACHER } from './paths';
import { OneTeacherPage } from './SchoolView';

/**
 * bd-fmf24g.8 — the teacher v2 Analytics page (flag-gated by App's TeacherGate). Registered, so More's
 * Analytics row comes here for a teacher with portal_teacher_v2; flag off, today's page as before.
 */
const routes: TeacherRoute[] = [
  { path: ANALYTICS_HOME, element: <AnalyticsPage /> },
  { path: ANALYTICS_TEACHER, element: <OneTeacherPage /> },
];

export default routes;
