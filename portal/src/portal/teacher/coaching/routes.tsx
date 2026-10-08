import type { TeacherRoute } from '../routes';
import { CoachingHomePage } from './CoachingHome';
import { ReportPage } from './ReportPage';
import { SendPage } from './SendPage';
import { COACHING_HOME, COACHING_REPORT, COACHING_SEND } from './paths';

/**
 * bd-fmf24g.4 — the teacher v2 Digital Coaching pages (each one flag-gated by App's TeacherGate). The
 * main page is registered, so every link to Digital Coaching (the bottom menu, Home's tile, More) comes
 * here for a teacher with portal_teacher_v2 (teacher/paths resolveTeacherPath); flag off, today's page.
 */
const routes: TeacherRoute[] = [
  { path: COACHING_HOME, element: <CoachingHomePage /> },
  { path: COACHING_SEND, element: <SendPage /> },
  { path: COACHING_REPORT, element: <ReportPage /> },
];

export default routes;
