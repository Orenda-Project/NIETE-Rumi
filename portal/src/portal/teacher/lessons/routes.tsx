import type { TeacherRoute } from '../routes';
import { ChaptersPage } from './ChaptersPage';
import { LessonsHomePage } from './LessonsHome';
import { LessonsPage } from './LessonsPage';
import { OpenPlanPage } from './OpenPlanPage';
import { PreparingPage } from './PreparingPage';
import { ViewerPage } from './ViewerPage';
import { LESSONS_HOME, LESSONS_OPEN, LESSONS_VIEWER } from './paths';

/**
 * bd-fmf24g.3 — the teacher v2 Lesson Plans pages (each one flag-gated by App's TeacherGate). The main
 * page is registered, so every link to Lesson Plans (the bottom menu, Home's tile, More) comes here for
 * a teacher with portal_teacher_v2 (teacher/paths resolveTeacherPath); flag off, today's page as before.
 */
const routes: TeacherRoute[] = [
  { path: LESSONS_HOME, element: <LessonsHomePage /> },
  { path: `${LESSONS_HOME}/chapters`, element: <ChaptersPage /> },
  { path: `${LESSONS_HOME}/lessons`, element: <LessonsPage /> },
  { path: `${LESSONS_HOME}/preparing`, element: <PreparingPage /> },
  { path: LESSONS_OPEN, element: <OpenPlanPage /> },
  { path: LESSONS_VIEWER, element: <ViewerPage /> },
];

export default routes;
