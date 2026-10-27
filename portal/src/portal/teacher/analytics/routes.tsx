import type { TeacherRoute } from '../routes';
import { ANALYTICS_HOME, ANALYTICS_TEACHER } from './paths';
import { lazyPage as page } from '@/lib/lazyPage';

// bd-sex15q.34 — each page is its own chunk (lib/lazyPage), so the teacher app is not in every first open.
const AnalyticsPage = page(() => import('./AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const OneTeacherPage = page(() => import('./SchoolView').then((m) => ({ default: m.OneTeacherPage })));

/**
 * bd-fmf24g.8 — the teacher v2 Analytics page (flag-gated by App's TeacherGate). Registered, so More's
 * Analytics row comes here for a teacher with portal_teacher_v2; flag off, today's page as before.
 */
const routes: TeacherRoute[] = [
  { path: ANALYTICS_HOME, element: <AnalyticsPage /> },
  { path: ANALYTICS_TEACHER, element: <OneTeacherPage /> },
];

export default routes;
