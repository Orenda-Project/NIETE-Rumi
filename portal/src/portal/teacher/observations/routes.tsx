import type { TeacherRoute } from '../routes';
import { ReportPage } from '../coaching/ReportPage';
import { ObservationsHomePage } from './ObservationsHome';
import { OBSERVATIONS_COPY as C } from './copy';
import { OBS_HOME, OBS_REPORT } from './paths';

/**
 * bd-fmf24g.4 — the teacher v2 Observations pages (flag-gated by App's TeacherGate). The main page is
 * registered, so every link to Observations comes here for a teacher with portal_teacher_v2; a coach
 * visit's report is the shared report page, with Observations as its way back.
 */
const routes: TeacherRoute[] = [
  { path: OBS_HOME, element: <ObservationsHomePage /> },
  { path: OBS_REPORT, element: <ReportPage backTo={OBS_HOME} crumb={C.title} /> },
];

export default routes;
