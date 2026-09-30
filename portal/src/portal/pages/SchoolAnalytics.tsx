import { useEffect, useState } from 'react';
import { Users, BookOpen, FileText } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import ObservationsSection from '../components/ObservationsSection';
import AttendanceSection from '../components/AttendanceSection';
import AttendancePanel from '../components/AttendancePanel';
import { AnalyticsControls } from '../components/AnalyticsControls';
import { useAnalyticsView } from '../lib/analyticsView';
import RemarksSection from '../components/RemarksSection';
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
  // Tab (#hash), date window (?from=&to=) and teacher (?teacherId=) all live
  // in the address. Step 5 of the principal's journey links to #remarks, which
  // now simply opens the Principal Remarks tab.
  const { tab, setTab, from, to, setRange, setParams, searchParams } = useAnalyticsView();
  const [teacherId, setTeacherId] = useState<string>(searchParams.get('teacherId') || '');

  // Keep the URL honest as she changes the filter, so the view is shareable and
  // the back button returns to what she was actually looking at.
  const selectTeacher = (id: string) => {
    setTeacherId(id);
    setParams({ teacherId: id || null });
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
      .getSchoolAnalytics(teacherId || null, { from, to })
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
  }, [teacherId, from, to]);

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

        </header>

        {/* bd-60122 — the row says ONE scope at a time. Observation counts
            moved into Observations; "Coaching sessions" is gone — it pooled
            both kinds under one number (operator, 2026-09-29). */}
        <p data-testid="kpi-scope" className="text-xs text-muted-foreground mb-2">
          {focusTeacher ? `${focusTeacher.name}'s numbers` : 'Across the whole school'}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6 mb-8">
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
          {/* Papers that finished generating — a failed or pending one is not an exam. */}
          <div data-testid="kpi-exams" className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-accent" />
              <span className="text-sm text-muted-foreground">Exams generated</span>
            </div>
            <div className="text-3xl font-bold">{school.totalExams ?? 0}</div>
          </div>
        </div>

        {/* S·T·E, then P, then the remark S — the STEPS order, one at a time. */}
        <AnalyticsControls tab={tab} onTab={setTab} from={from} to={to} onRange={setRange} />
        {tab === 'observations' && (
          <ObservationsSection analytics={analytics} showTeacher={!focusTeacher} range={{ from, to }} />
        )}
        {tab === 'attendance' && (
          <>
            <AttendanceSection presence={presence} />
            <AttendancePanel from={from} to={to} teacherId={focusTeacher ? focusTeacher.id : null} />
          </>
        )}
        {tab === 'remarks' && <RemarksSection remarks={remarks} />}

      </div>
    </PortalLayout>
  );
};

export default SchoolAnalytics;
