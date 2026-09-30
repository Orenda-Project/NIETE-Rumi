import { Navigate, useLocation } from 'react-router-dom';

/**
 * The separate Attendance pages were absorbed into the Analytics Attendance
 * tab (operator, 2026-09-30). Old links — bookmarks, a shared URL — still
 * land somewhere useful: the same Analytics page, on its Attendance tab,
 * keeping the query (?teacherId=, ?from=, ?to=) they carried.
 */
const LegacyAttendanceRedirect = ({ to }: { to: string }) => {
  const { search } = useLocation();
  return <Navigate replace to={`${to}${search}#attendance`} />;
};

export default LegacyAttendanceRedirect;
