import type { TeacherRoute } from '../routes';
import { AnalyticsPage } from './AnalyticsPage';
import { ANALYTICS_HOME } from './paths';

/**
 * bd-fmf24g.8 — the teacher v2 Analytics page (flag-gated by App's TeacherGate). Registered, so More's
 * Analytics row comes here for a teacher with portal_teacher_v2; flag off, today's page as before.
 */
const routes: TeacherRoute[] = [{ path: ANALYTICS_HOME, element: <AnalyticsPage /> }];

export default routes;
