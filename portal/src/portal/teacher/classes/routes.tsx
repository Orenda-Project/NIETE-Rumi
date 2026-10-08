import type { TeacherRoute } from '../routes';
import { AddClassPage } from './AddClassPage';
import { ClassDetailPage } from './ClassDetailPage';
import { MyClassesPage } from './MyClassesPage';
import { CLASSES_ADD, CLASSES_HOME, CLASS_DETAIL } from './paths';

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
