import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
import ScoreIndicator from '../components/ScoreIndicator';
import { leader } from '../services/api';
import type { SchoolAnalyticsResponse } from '../types/portal';

/**
 * bd-60121 — every observed lesson, on its own page.
 *
 * It used to be an uncapped list at the bottom of Analytics. Measured on prod:
 * 157 schools have at least one scored lesson, median 5 rows, p90 13, max 63 —
 * and it grows as observation coverage improves, so it gets worse over time
 * rather than better. Capping it in the panel would have hidden the tail
 * instead of housing it; this follows the attendance pattern the operator
 * asked for (2026-09-18) — a short preview on the panel, the full list here.
 *
 * Same data as the Analytics page (`scoreTrend` already carries every point,
 * with its marks and whose lesson it was), so there is no new endpoint and the
 * two views cannot disagree about what a lesson scored.
 */
const SchoolLessons = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [teacherId, setTeacherId] = useState(searchParams.get('teacherId') || '');
  const [data, setData] = useState<SchoolAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const selectTeacher = (id: string) => {
    setTeacherId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('teacherId', id); else next.delete('teacherId');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    let alive = true;
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
    // `data` only distinguishes a first load from a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  if (loading) return <PortalLayout><LoadingState type="full" /></PortalLayout>;

  if (forbidden) {
    return (
      <PortalLayout>
        <div className="container mx-auto max-w-7xl px-6 py-8">
          <div data-testid="not-for-you" className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <h1 className="text-2xl font-light mb-2">Observed lessons</h1>
            <p className="text-muted-foreground">
              This view belongs to a school's principal — your patch covers more than one school.
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
          <p className="text-muted-foreground">Observed lessons aren't available right now.</p>
        </div>
      </PortalLayout>
    );
  }

  const { school, analytics } = data;
  const focusTeacher = data.focusTeacher ?? null;
  const teachers = data.teachers ?? [];
  // Newest first: the list is read as "what happened recently".
  const lessons = [...(analytics.scoreTrend ?? [])].reverse();

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <Link
          to="/portal/leader/school-analytics"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to analytics
        </Link>

        <header className="mb-6">
          <h1 className="text-3xl sm:text-4xl font-light mb-2">Observed lessons</h1>
          <p className="text-muted-foreground" data-testid="scope-label">
            {focusTeacher
              ? `${focusTeacher.name} — every lesson a coach sat in on.`
              : `${school.name || 'Your school'} — every lesson a coach sat in on, newest first.`}
          </p>
        </header>

        <div className="bg-white rounded-lg p-4 shadow-sm border border-border mb-6 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="teacher-filter" className="text-xs text-muted-foreground">Teacher</label>
            <select
              id="teacher-filter"
              data-testid="teacher-filter"
              value={teacherId}
              onChange={(e) => selectTeacher(e.target.value)}
              className="border border-border rounded-md px-3 py-2 text-sm bg-white"
            >
              <option value="">Everyone</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="text-sm text-muted-foreground pb-2">
            {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
          </div>

          {refetching && (
            <span data-testid="refetching" role="status" aria-live="polite"
              className="ml-auto inline-flex items-center gap-2 text-sm text-muted-foreground">
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent" />
              Updating…
            </span>
          )}
        </div>

        {lessons.length === 0 ? (
          <div data-testid="lessons-empty" className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <h2 className="text-lg font-medium mb-2">No observed lessons yet</h2>
            <p className="text-muted-foreground text-sm">
              Once a coach sits in on a lesson and scores it, it will appear here.
            </p>
          </div>
        ) : (
          <section
            data-testid="lessons-list"
            className="bg-white rounded-lg shadow-sm border border-border overflow-hidden"
          >
            <ul className="divide-y divide-border">
              {lessons.map((p, i) => (
                <li
                  key={`${p.date}-${i}`}
                  data-testid={`lesson-row-${i}`}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {new Date(p.date).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </p>
                    <p className="text-muted-foreground text-sm truncate">
                      {/* Whose lesson — but not when the view is already one
                          teacher, where repeating her name on every row is noise. */}
                      {!focusTeacher && p.teacherName && <>{p.teacherName}</>}
                      {!focusTeacher && p.teacherName && p.points != null && <> · </>}
                      {p.points != null && p.maxPoints != null && (
                        <>{p.points} / {p.maxPoints} marks</>
                      )}
                    </p>
                  </div>
                  <ScoreIndicator percentage={p.percentage} size="small" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PortalLayout>
  );
};

export default SchoolLessons;
