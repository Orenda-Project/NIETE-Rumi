import type { TeacherRoute } from '../routes';
import { CLASSES_ADD, CLASSES_HOME, CLASS_DETAIL } from './paths';
import { lazyPage as page } from '@/lib/lazyPage';

// bd-sex15q.34 — each page is its own chunk (lib/lazyPage), so the teacher app is not in every first open.
const AddClassPage = page(() => import('./AddClassPage').then((m) => ({ default: m.AddClassPage })));
const ClassDetailPage = page(() => import('./ClassDetailPage').then((m) => ({ default: m.ClassDetailPage })));
const MyClassesPage = page(() => import('./MyClassesPage').then((m) => ({ default: m.MyClassesPage })));

/**
 * bd-fmf24g.8 — the teacher v2 My Classes pages (each flag-gated by App's TeacherGate). With the main page
 * registered, every link to My Classes (Home's tile, More) comes here for a teacher with portal_teacher_v2.
 */
const routes: TeacherRoute[] = [
  { path: CLASSES_HOME, element: <MyClassesPage /> },
  { path: CLASSES_ADD, element: <AddClassPage /> },
  { path: CLASS_DETAIL, element: <ClassDetailPage /> },
];

export default routes;
