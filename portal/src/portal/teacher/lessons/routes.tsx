import type { TeacherRoute } from '../routes';
import { ChaptersPage } from './ChaptersPage';
import { LessonsPage } from './LessonsPage';
import { PreparingPage } from './PreparingPage';
import { ViewerPage } from './ViewerPage';
import { LESSONS_HOME, LESSONS_VIEWER } from './paths';

/**
 * bd-fmf24g.3 — the teacher v2 Lesson Plans pages (each one flag-gated by App's TeacherGate).
 *
 * The INNER pages only, for now. The main page (LESSONS_HOME: Select your class · Any grade or subject
 * · Recent) waits for the kit's GradeSubjectPicker and GradeSubjectSelector; until it is registered,
 * every link to Lesson Plans still goes to today's page (teacher/paths resolveTeacherPath).
 */
const routes: TeacherRoute[] = [
  { path: `${LESSONS_HOME}/chapters`, element: <ChaptersPage /> },
  { path: `${LESSONS_HOME}/lessons`, element: <LessonsPage /> },
  { path: `${LESSONS_HOME}/preparing`, element: <PreparingPage /> },
  { path: LESSONS_VIEWER, element: <ViewerPage /> },
];

export default routes;
