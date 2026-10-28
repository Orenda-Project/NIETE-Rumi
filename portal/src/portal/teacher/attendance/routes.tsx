import type { TeacherRoute } from '../routes';
import { ATTENDANCE_V2_BASE as B } from './paths';
import { lazyPage as page } from '@/lib/lazyPage';

// bd-sex15q.34 — each page is its own chunk (lib/lazyPage), so the teacher app is not in every first open.
const AttendanceHub = page(() => import('./AttendanceHub').then((m) => ({ default: m.AttendanceHub })));
const DownloadPage = page(() => import('./DownloadPage').then((m) => ({ default: m.DownloadPage })));
const MarkPage = page(() => import('./MarkPage').then((m) => ({ default: m.MarkPage })));
const ViewPage = page(() => import('./ViewPage').then((m) => ({ default: m.ViewPage })));

/**
 * bd-fmf24g.7 — the teacher v2 Attendance pages (each flag-gated by App's TeacherGate). The main page is
 * registered, so every link to Attendance (Home's tile, More) comes here for a teacher with
 * portal_teacher_v2; flag off, today's page as before.
 */
const routes: TeacherRoute[] = [
  { path: B, element: <AttendanceHub /> },
  { path: `${B}/:listId/mark`, element: <MarkPage /> },
  { path: `${B}/:listId/view`, element: <ViewPage /> },
  { path: `${B}/:listId/download`, element: <DownloadPage /> },
];

export default routes;
