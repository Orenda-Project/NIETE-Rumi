import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Users, BookOpen, UserCheck, ClipboardCheck } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import TeacherSteps from '../components/TeacherSteps';
import ObservationsSection from '../components/ObservationsSection';
import NextStep from '../components/NextStep';
import { leader } from '../services/api';
import type { SchoolAnalyticsResponse } from '../types/portal';

/**
 * bd-60117 — the Analytics tab for a PRINCIPAL: her school, not herself.
 *
 * Why this is a separate page rather than a branch inside
 * PortalCoachingAnalytics: that page answers "how am I doing?" from one
 * teacher's own sessions, and for a principal that page is empty — all 460
 * principals together hold 46 own completed sessions (0.10 each, NIETE prod
 * 2026-09-17). Her school's data is the substantial one: of 40 principals
 * sampled, every one had staff (avg 14.7) and 34 had scored sessions, some
 * with 68, 79, 135.
 *
 * It also could not reuse that page's maths. The six goal areas hardcoded
 * there (Formative Assessment / Student Engagement / … at maxes 22/22/38/5/
 * 21/15) come from an upstream framework NIETE never writes: there is no
 * goal1_total in this deployment's data, so each one would render a confident
 * 0%. The domains here are whatever the sessions actually contain.
 */

const SchoolAnalytics = () => {
  const [data, setData] = useState<SchoolAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  // bd-60118 — '' means the whole school. The server validates the id against
  // her roster, so this is a convenience rather than the access boundary.
  // bd-60119: seeded from ?teacherId=, so the roster can deep-link straight to
  // one teacher's numbers and the dropdown shows her as selected on arrival.
  const [searchParams, setSearchParams] = useSearchParams();
  // Step 5 of the principal's journey links to #remarks. React Router does not
  // scroll to a hash on its own, and the section only exists once the data has
  // loaded, so it is scrolled to after the first render that has it.
  const { hash } = useLocation();
  const [teacherId, setTeacherId] = useState<string>(searchParams.get('teacherId') || '');

  // Keep the URL honest as she changes the filter, so the view is shareable and
  // the back button returns to what she was actually looking at.
  const selectTeacher = (id: string) => {
    setTeacherId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('teacherId', id); else next.delete('teacherId');
    setSearchParams(next, { replace: true });
  };
  // Distinct from `loading`, which is only ever true before the FIRST load.
  // Without this a filter change swapped every number in place with nothing on
  // screen to say so — on a slow link that reads as a broken filter, or worse,
  // the previous teacher's numbers get read as the new teacher's.
  const [refetching, setRefetching] = useState(false);
  // 403 is a real answer, not an error: the other four leader-family roles are
  // multi-school, so there is no single school whose numbers would be theirs.
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let alive = true;
    // First load owns the full-page loader; every later one is a refetch, which
    // must keep the page (and the filter she is still using) on screen.
    setRefetching((prev) => (data ? true : prev));
    leader
      .getSchoolAnalytics(teacherId || null)
      .then((d) => { if (alive) setData(d); })
      .catch((err) => {
        if (!alive) return;
        if (err?.response?.status === 403) setForbidden(true);
        setData(null);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
        setRefetching(false);
      });
    return () => { alive = false; };
    // `data` is deliberately not a dependency: it is read only to tell a first
    // load from a refetch, and depending on it would refetch on every result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  useEffect(() => {
    if (loading || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, hash]);

  if (loading) {
    return <PortalLayout><LoadingState type="full" /></PortalLayout>;
  }

  if (forbidden) {
    return (
      <PortalLayout>
        <div className="container mx-auto max-w-7xl px-6 py-8">
          <div
            data-testid="not-for-you"
            className="bg-white rounded-lg p-6 shadow-sm border border-border"
          >
            <h1 className="text-2xl font-light mb-2">School analytics</h1>
            <p className="text-muted-foreground">
              This view belongs to a school's principal. Your patch covers more than one
              school — see My Patch and Teachers for the whole picture.
            </p>
          </div>
        </div>
      </PortalLayout>
    );
  }

  if (!data) {
    return (
      <PortalLayout>
        <div className="container mx-auto max-w-7xl px-6 py-8">
          <p className="text-muted-foreground">
            Your school analytics aren't available right now.
          </p>
        </div>
      </PortalLayout>
    );
  }

  // Defaulted rather than destructured bare: an older cached bundle, a partial
  // response or a mid-deploy version skew would otherwise crash the whole page
  // on `.length` of undefined, turning a missing PANEL into a blank SCREEN.
  const { school, analytics } = data;
  const focusTeacher = data.focusTeacher ?? null;
  const teachers = data.teachers ?? [];
  const presence = data.presence ?? {
    teacher: { records: 0, present: 0, absent: 0, leave: 0, presentPct: null },
    student: { sessions: 0, totalMarked: 0, present: 0, presentPct: null },
  };
  const remarks = data.remarks ?? {
    submitted: 0, averagePct: null, indicatorBreakdown: [], focusIndicator: null,
  };
  return (
    <PortalLayout>
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-light mb-2">School Analytics</h1>
          <p className="text-muted-foreground" data-testid="scope-label">
            {focusTeacher
              ? `${school.name || 'Your school'} — ${focusTeacher.name}`
              : `${school.name || 'Your school'} — how your teachers are doing overall.`}
          </p>

          {/* bd-60118 — one teacher's report card, on the same page. Osama,
              2026-09-10: "build teacher report card individually". Every panel
              below re-scopes together, so there is never a mix of one
              teacher's presence beside the whole school's scores. */}
          {teachers.length > 0 && (
            <div className="mt-4">
              <label htmlFor="teacher-filter" className="text-sm text-muted-foreground mr-2">
                Showing
              </label>
              <select
                id="teacher-filter"
                data-testid="teacher-filter"
                value={teacherId}
                onChange={(e) => selectTeacher(e.target.value)}
                className="border border-border rounded-md px-3 py-2 text-sm bg-white"
              >
                <option value="">The whole school</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>

              {/* Beside the control that caused it, not over the page: she is
                  still using this filter, and a full-page loader would throw
                  away her scroll position mid-comparison. */}
              {refetching && (
                <span
                  data-testid="refetching"
                  role="status"
                  aria-live="polite"
                  className="ml-3 inline-flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent" />
                  Updating…
                </span>
              )}
            </div>
          )}

          {/* bd-60119: a principal's teacher IS this page filtered to her, so
              her STEPS row lives here — each letter a link into her own view. */}
          {focusTeacher && <TeacherSteps teacherId={focusTeacher.id} />}
        </header>

        {/* bd-60122 — the row says ONE scope at a time. Observation counts
            moved into Observations; "Coaching sessions" is gone — it pooled
            both kinds under one number (operator, 2026-09-29). */}
        <p data-testid="kpi-scope" className="text-xs text-muted-foreground mb-2">
          {focusTeacher ? `${focusTeacher.name}'s numbers` : 'Across the whole school'}
        </p>
        <div className="grid grid-cols-2 gap-4 sm:gap-6 mb-8">
          {!focusTeacher && (
            <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5 text-accent" />
                <span className="text-sm text-muted-foreground">Teachers</span>
              </div>
              <div data-testid="kpi-teachers" className="text-3xl font-bold">
                {school.totalTeachers}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{school.onRumi} on NIETE</p>
            </div>
          )}
          <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-5 h-5 text-accent" />
              <span className="text-sm text-muted-foreground">Lesson plans</span>
            </div>
            <div data-testid="kpi-lesson-plans" className="text-3xl font-bold">
              {school.totalLessonPlans}
            </div>
          </div>
        </div>

        {/* S·T·E first, then P, then the remark S — the STEPS order. */}
        <ObservationsSection analytics={analytics} showTeacher={!focusTeacher} />

        {/* ── Presence ───────────────────────────────────────────────────
            Teacher and student presence sit SIDE BY SIDE, never blended. The
            60:40 weighting between them was never locked — Sabeena, 2026-08-10:
            start there and "adjust the percentage accordingly based on the
            findings" after the pilot, and that thread is still open. Momina's
            objection is the reason it is open: rural student absence is driven
            by circumstances at home, so folding it into one teacher-facing
            number can misattribute it. */}
        <section className="bg-white rounded-lg p-6 shadow-sm border border-border mb-8">
          <div className="flex items-center gap-2 mb-6">
            <UserCheck className="w-5 h-5 text-accent" />
            <h2 className="text-2xl font-light">Attendance</h2>
            {/* bd-60123 — the full picture lives on its own page: every grade
                merged across children and days, with a day-by-day view and
                date/teacher filters. This panel stays the headline. */}
            <Link
              to="/portal/leader/attendance"
              data-testid="attendance-detail-link"
              className="ml-auto text-sm font-medium text-accent hover:underline"
            >
              See all attendance →
            </Link>
          </div>
          <p data-testid="presence-help" className="text-muted-foreground text-sm mb-6">
            From the registers marked on NIETE. Teacher and student attendance are kept
            separate — a teacher is not marked down for children kept home.
          </p>

          {presence.teacher.presentPct == null && presence.student.presentPct == null ? (
            <p data-testid="presence-empty" className="text-muted-foreground text-sm">
              No attendance has been marked yet. Once registers are taken on NIETE,
              teacher and student attendance will show here.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {presence.teacher.presentPct != null && (
                <div className="p-4 bg-secondary rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold">Teachers present</h3>
                    <span data-testid="presence-teacher" className="text-2xl font-bold text-accent">
                      {presence.teacher.presentPct}%
                    </span>
                  </div>
                  {/* Leave is named, not hidden inside the absent count — a
                      teacher on approved leave was not absent. */}
                  <p className="text-xs text-muted-foreground">
                    {presence.teacher.present} present · {presence.teacher.absent} absent
                    {presence.teacher.leave > 0 && <> · {presence.teacher.leave} on leave</>}
                  </p>
                </div>
              )}

              {presence.student.presentPct != null && (
                <div className="p-4 bg-secondary rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold">Students present</h3>
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

        {/* ── Supervisor remarks ─────────────────────────────────────────
            Her OWN quarterly evaluations, read back to her. Only submitted
            forms appear: scores are written as she answers, so a part-finished
            form would otherwise show a teacher a "result" she never gave.
            id="remarks" is where the principal's STEPS journey ends. */}
        <section id="remarks" className="bg-white rounded-lg p-6 shadow-sm border border-border mb-8 scroll-mt-20">
          <div className="flex items-center gap-2 mb-6">
            <ClipboardCheck className="w-5 h-5 text-accent" />
            <h2 className="text-2xl font-light">Principal Remarks</h2>
          </div>
          <p data-testid="remarks-help" className="text-muted-foreground text-sm mb-6">
            The quarterly reviews you submitted yourself on WhatsApp, rated 1 to 4 across
            five areas. Only finished reviews are counted.
          </p>

          {remarks.submitted === 0 ? (
            <p data-testid="remarks-empty" className="text-muted-foreground text-sm">
              You haven't submitted any teacher evaluations yet this quarter. Send
              <strong> /remark</strong> on WhatsApp to start one.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-6">
                <p className="text-muted-foreground text-sm">
                  {remarks.submitted} evaluation{remarks.submitted === 1 ? '' : 's'} submitted
                </p>
                <div className="text-right">
                  <span className="text-sm text-muted-foreground block">Average</span>
                  <span data-testid="remarks-average" className="text-2xl font-bold text-accent">
                    {remarks.averagePct}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {remarks.indicatorBreakdown.map((i) => (
                  <div key={i.key} data-testid={`remark-${i.key}`} className="p-4 bg-secondary rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-sm">{i.name}</h3>
                      <span className="text-lg font-bold text-accent whitespace-nowrap">
                        {i.average}/4
                      </span>
                    </div>
                    <div className="w-full bg-background rounded-full h-2">
                      <div
                        className="bg-accent h-2 rounded-full transition-all"
                        style={{ width: `${i.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {remarks.focusIndicator && (
                <p className="text-sm text-muted-foreground mt-4">
                  Lowest rated: <strong data-testid="remarks-focus">{remarks.focusIndicator}</strong>
                </p>
              )}
            </>
          )}
        </section>

        {focusTeacher && (
          <NextStep to={`/portal/leader/lessons?teacherId=${focusTeacher.id}`} step={3} label="Review her lessons" />
        )}
      </div>
    </PortalLayout>
  );
};

export default SchoolAnalytics;
