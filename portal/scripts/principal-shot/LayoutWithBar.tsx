import type { ReactNode } from 'react';
import TeacherNavigation from '@/portal/teacher/TeacherNavigation';

/**
 * bd-33wxxi.11 — the harness's stand-in for PortalLayout (auth, queries): the page, then the REAL teacher-app phone
 * bar (TeacherNavigation), as PortalNavigation draws it for a principal on the teacher app.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f7f7f8] pb-24">
      {children}
      <TeacherNavigation />
    </div>
  );
}
