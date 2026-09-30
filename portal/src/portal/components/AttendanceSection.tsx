import { Link } from 'react-router-dom';
import { UserCheck } from 'lucide-react';
import type { SchoolPresence } from '../types/portal';

/**
 * Attendance — the P of STEPS. Teacher and student presence sit SIDE BY SIDE,
 * never blended: the 60:40 weighting between them was never locked (Sabeena,
 * 2026-08-10, thread still open), and rural student absence is driven by
 * circumstances at home, so one teacher-facing number could misattribute it.
 *
 * `audience` changes the words only: a principal reads about her teachers
 * (with a link to the full attendance page, which is principal-only); a
 * teacher reads about herself and the registers she took.
 */
const AttendanceSection = ({ presence, audience = 'principal' }: {
  presence: SchoolPresence; audience?: 'principal' | 'teacher';
}) => {
  const mine = audience === 'teacher';
  return (
    <section className="bg-white rounded-lg p-6 shadow-sm border border-border mb-8">
      <div className="flex items-center gap-2 mb-6">
        <UserCheck className="w-5 h-5 text-accent" />
        <h2 className="text-2xl font-light">Attendance</h2>
        {/* Each audience's own full page: the school's, or her classes and her days. */}
        <Link
          to={mine ? '/portal/attendance' : '/portal/leader/attendance'}
          data-testid={mine ? 'my-attendance-link' : 'attendance-detail-link'}
          className="ml-auto text-sm font-medium text-accent hover:underline"
        >
          {mine ? 'See each day →' : 'See all attendance →'}
        </Link>
      </div>
      <p data-testid="presence-help" className="text-muted-foreground text-sm mb-6">
        {mine
          ? 'From the registers marked on NIETE. Your own attendance and your students’ are kept separate — you are not marked down for children kept home.'
          : 'From the registers marked on NIETE. Teacher and student attendance are kept separate — a teacher is not marked down for children kept home.'}
      </p>

      {presence.teacher.presentPct == null && presence.student.presentPct == null ? (
        <p data-testid="presence-empty" className="text-muted-foreground text-sm">
          No attendance has been marked yet. Once registers are taken on NIETE,
          {mine ? ' your attendance and your students’ will show here.' : ' teacher and student attendance will show here.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {presence.teacher.presentPct != null && (
            <div data-testid="presence-teacher-block" className="p-4 bg-secondary rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{mine ? 'You were present' : 'Teachers present'}</h3>
                <span data-testid="presence-teacher" className="text-2xl font-bold text-accent">
                  {presence.teacher.presentPct}%
                </span>
              </div>
              {/* Leave is named, not hidden inside the absent count. */}
              <p className="text-xs text-muted-foreground">
                {presence.teacher.present} present · {presence.teacher.absent} absent
                {presence.teacher.leave > 0 && <> · {presence.teacher.leave} on leave</>}
              </p>
            </div>
          )}
          {presence.student.presentPct != null && (
            <div data-testid="presence-student-block" className="p-4 bg-secondary rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{mine ? 'Your students present' : 'Students present'}</h3>
                <span data-testid="presence-student" className="text-2xl font-bold text-accent">
                  {presence.student.presentPct}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {presence.student.present} of {presence.student.totalMarked} across{' '}
                {presence.student.sessions} register{presence.student.sessions === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default AttendanceSection;
