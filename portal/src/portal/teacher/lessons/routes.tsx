import type { TeacherRoute } from '../routes';
import { ChaptersPage } from './ChaptersPage';
import { LessonsAllPage } from './LessonsAll';
import { LessonsHomePage } from './LessonsHome';
import { LessonsPage } from './LessonsPage';
import { NewLessonPage } from './NewLessonPage';
import { OpenPlanPage } from './OpenPlanPage';
import { ChangePage } from './own/ChangePage';
import { OwnPage } from './own/OwnPage';
import { UnitGoalsPage } from './own/UnitGoalsPage';
import { UnitNewPage } from './own/UnitNewPage';
import { UnitPage } from './own/UnitPage';
import { PreparingPage } from './PreparingPage';
import { ReviewPage } from './shelf/ReviewPage';
import { ViewerPage } from './ViewerPage';
import { LESSONS_ALL, LESSONS_HOME, LESSONS_NEW, LESSONS_OPEN, LESSONS_OWN, LESSONS_VIEWER } from './paths';
import { LESSONS_CHANGE } from './own/change';
import { LESSONS_CHECK } from './shelf/flag';
import { LESSONS_UNIT, LESSONS_UNIT_GOALS, LESSONS_UNIT_NEW } from './own/unitPaths';

/**
 * bd-fmf24g.3 — the teacher v2 Lesson Plans pages (each one flag-gated by App's TeacherGate). The main
 * page is registered, so every link to Lesson Plans (the bottom menu, Home's tile, More) comes here for
 * a teacher with portal_teacher_v2 (teacher/paths resolveTeacherPath); flag off, today's page as before.
 *
 * bd-4joiqz — `leaders`: the leader family reads these same pages (the coach app's Lesson Plans tab, the leader
 * menu's Lesson Plans). Every page but All Lesson Plans, which is a teacher's own history. What a leader does not see
 * on them (Start DC observation, Thing to try, Send on WhatsApp, Recent) is lessons/audience.ts's call.
 */
const routes: TeacherRoute[] = [
  { path: LESSONS_HOME, element: <LessonsHomePage />, leaders: true },
  { path: LESSONS_NEW, element: <NewLessonPage />, leaders: true },
  { path: `${LESSONS_HOME}/chapters`, element: <ChaptersPage />, leaders: true },
  { path: `${LESSONS_HOME}/lessons`, element: <LessonsPage />, leaders: true },
  { path: `${LESSONS_HOME}/preparing`, element: <PreparingPage />, leaders: true },
  { path: LESSONS_OPEN, element: <OpenPlanPage />, leaders: true },
  { path: LESSONS_ALL, element: <LessonsAllPage /> },
  { path: LESSONS_VIEWER, element: <ViewerPage />, leaders: true },
  // bd-snkn32 — Make my own (dark unless lpMakeOwn): a teacher's own plan, so not the leaders'.
  { path: LESSONS_OWN, element: <OwnPage /> },
  // bd-snkn32.15 — Change this plan: hers too.
  { path: LESSONS_CHANGE, element: <ChangePage /> },
  // bd-snkn32.59.1 (queue #165) — A whole unit (dark unless lpOwnUnit): hers too.
  { path: LESSONS_UNIT_NEW, element: <UnitNewPage /> },
  { path: LESSONS_UNIT, element: <UnitPage /> },
  // bd-snkn32.59.4 — a unit from her learning goals (no textbook): dark unless lpOwnUnit AND lpOwnGoalStart.
  { path: LESSONS_UNIT_GOALS, element: <UnitGoalsPage /> },
  // bd-snkn32.42 — the staff check before a teacher's plan is listed (only for portal_lp_own_reviewers; 404 for the rest).
  { path: LESSONS_CHECK, element: <ReviewPage />, leaders: true },
];

export default routes;
