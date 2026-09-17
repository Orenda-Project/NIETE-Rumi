import { useEffect, useState } from 'react';
import { TrendingUp, Target, Users, BookOpen, Calendar } from 'lucide-react';
import Chart from 'react-apexcharts';
import { ApexOptions } from 'apexcharts';
import PortalLayout from '../components/PortalLayout';
import LoadingState from '../components/LoadingState';
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
  // 403 is a real answer, not an error: the other four leader-family roles are
  // multi-school, so there is no single school whose numbers would be theirs.
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let alive = true;
    leader
      .getSchoolAnalytics()
      .then((d) => { if (alive) setData(d); })
      .catch((err) => {
        if (!alive) return;
        if (err?.response?.status === 403) setForbidden(true);
        setData(null);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

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

  const { school, analytics } = data;
  const hasData = analytics.totalSessions > 0;

  const trendOptions: ApexOptions = {
    chart: { type: 'line', toolbar: { show: false }, zoom: { enabled: false } },
    stroke: { curve: 'smooth', width: 3 },
    colors: ['hsl(15, 85%, 60%)'],
    grid: { borderColor: 'hsl(220, 13%, 91%)', strokeDashArray: 4 },
    xaxis: {
      categories: analytics.scoreTrend.map((p) =>
        new Date(p.date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })),
      labels: { style: { colors: 'hsl(220, 9%, 46%)', fontSize: '12px' } },
    },
    yaxis: { min: 0, max: 100, labels: { formatter: (v) => `${v}%` } },
    tooltip: { y: { formatter: (v) => `${v}%` } },
    dataLabels: { enabled: false },
    markers: { size: 4 },
  };

  const domainOptions: ApexOptions = {
    chart: { type: 'bar', toolbar: { show: false } },
    plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
    colors: ['hsl(15, 85%, 60%)'],
    dataLabels: { enabled: true, formatter: (v) => `${v}%`, offsetX: 28 },
    xaxis: {
      categories: analytics.domainBreakdown.map((d) => d.name),
      max: 100,
      labels: { formatter: (v) => `${v}%` },
    },
    grid: { borderColor: 'hsl(220, 13%, 91%)', strokeDashArray: 4 },
    tooltip: { y: { formatter: (v) => `${v}%` } },
  };

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-light mb-2">Your school</h1>
          <p className="text-muted-foreground">
            {school.name || 'Your school'} — how your teachers are doing overall.
          </p>
        </header>

        {/* Roster KPIs render even with no coaching yet: "18 teachers, 5 on
            Rumi" is useful on its own, and is the state 6 of 40 sampled
            schools are actually in. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-accent" />
              <span className="text-sm text-muted-foreground">Teachers</span>
            </div>
            <div data-testid="kpi-teachers" className="text-3xl font-bold">
              {school.totalTeachers}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{school.onRumi} on Rumi</p>
          </div>

          <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-5 h-5 text-accent" />
              <span className="text-sm text-muted-foreground">Coaching sessions</span>
            </div>
            <div data-testid="kpi-sessions" className="text-3xl font-bold">
              {analytics.totalSessions}
            </div>
          </div>

          {analytics.averageScore != null && (
            <div className="bg-white rounded-lg p-6 shadow-sm border border-border">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-accent" />
                <span className="text-sm text-muted-foreground">Average score</span>
              </div>
              <div data-testid="kpi-avg-score" className="text-3xl font-bold">
                {analytics.averageScore}%
              </div>
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

        {!hasData ? (
          // Say the true thing. A 0% average and a flat chart would read as "my
          // school scores zero", which is a different and much worse claim than
          // "nobody has been coached yet".
          <div
            data-testid="empty-analytics"
            className="bg-white rounded-lg p-6 shadow-sm border border-border"
          >
            <h2 className="text-lg font-medium mb-2">No coaching sessions yet</h2>
            <p className="text-muted-foreground text-sm">
              Once your teachers record a coaching session on Rumi, their scores and the
              areas to focus on will show up here.
            </p>
          </div>
        ) : (
          <>
            <section className="bg-white rounded-lg p-6 shadow-sm border border-border mb-8">
              <h2 className="text-2xl font-light mb-6">Score over time</h2>
              <Chart
                options={trendOptions}
                series={[{ name: 'Score', data: analytics.scoreTrend.map((p) => p.percentage) }]}
                type="line"
                height={320}
              />
            </section>

            <section className="bg-white rounded-lg p-6 shadow-sm border border-border mb-8">
              <h2 className="text-2xl font-light mb-6">By area</h2>
              <Chart
                options={domainOptions}
                series={[{ name: 'Score', data: analytics.domainBreakdown.map((d) => d.percentage) }]}
                type="bar"
                height={300}
              />

              {/* The session count sits next to every domain on purpose. NIETE
                  has two rubrics live at once — one set appears in 182 of 200
                  sessions, another in 15 — so a domain measured a handful of
                  times would otherwise read as a school-wide weakness. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                {analytics.domainBreakdown.map((d) => (
                  <div
                    key={d.key}
                    data-testid={`domain-${d.key}`}
                    className="p-4 bg-secondary rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold">{d.name}</h3>
                      <span className="text-2xl font-bold text-accent">{d.percentage}%</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      from {d.sessions} session{d.sessions === 1 ? '' : 's'}
                    </p>
                    <div className="w-full bg-background rounded-full h-2">
                      <div
                        className="bg-accent h-2 rounded-full transition-all"
                        style={{ width: `${d.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {analytics.focusDomain && (
              <section className="bg-gradient-to-r from-accent/10 to-primary/10 rounded-lg p-6 border border-accent/20">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-white rounded-lg">
                    <Target className="w-6 h-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Where to focus</h3>
                    <p className="text-foreground">
                      Across your school, <strong data-testid="focus-domain">{analytics.focusDomain}</strong>{' '}
                      is scoring lowest
                      {analytics.strongestDomain && <> — {analytics.strongestDomain} is strongest</>}.
                    </p>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </PortalLayout>
  );
};

export default SchoolAnalytics;
