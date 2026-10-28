import type { TeacherRoute } from '../routes';
import { LESSONS_ALL, LESSONS_HOME, LESSONS_NEW, LESSONS_OPEN, LESSONS_VIEWER } from './paths';
import { lazyPage as page } from '@/lib/lazyPage';

// bd-sex15q.34 — each page is its own chunk (lib/lazyPage), so the teacher app is not in every first open.
const ChaptersPage = page(() => import('./ChaptersPage').then((m) => ({ default: m.ChaptersPage })));
const LessonsAllPage = page(() => import('./LessonsAll').then((m) => ({ default: m.LessonsAllPage })));
const LessonsHomePage = page(() => import('./LessonsHome').then((m) => ({ default: m.LessonsHomePage })));
const LessonsPage = page(() => import('./LessonsPage').then((m) => ({ default: m.LessonsPage })));
const NewLessonPage = page(() => import('./NewLessonPage').then((m) => ({ default: m.NewLessonPage })));
const OpenPlanPage = page(() => import('./OpenPlanPage').then((m) => ({ default: m.OpenPlanPage })));
const PreparingPage = page(() => import('./PreparingPage').then((m) => ({ default: m.PreparingPage })));
const ViewerPage = page(() => import('./ViewerPage').then((m) => ({ default: m.ViewerPage })));

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
];

export default routes;
