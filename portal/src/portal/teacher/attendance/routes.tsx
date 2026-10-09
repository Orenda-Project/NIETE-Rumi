import type { TeacherRoute } from '../routes';
import { AttendanceHub } from './AttendanceHub';
import { DownloadPage } from './DownloadPage';
import { MarkPage } from './MarkPage';
import { ATTENDANCE_V2_BASE as B } from './paths';
import { ViewPage } from './ViewPage';

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
