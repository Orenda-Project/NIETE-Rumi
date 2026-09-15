import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, MessageSquare, BookOpen, FileText, Users } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { leader } from "../services/api";
import PortalLayout from "../components/PortalLayout";
import StatCard from "../components/StatCard";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";
import ScoreIndicator from "../components/ScoreIndicator";
import type { LeaderTeacherDetail as Detail } from "../types/portal";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The x-axis tick. A custom renderer rather than recharts' default so the label is a
 * findable element, not a coordinate that only a screenshot could check.
 */
const TrendTick = ({ x, y, payload }: any) => (
  <text data-testid="trend-x-label" x={x} y={y + 14} textAnchor="middle" fontSize={11} fill="currentColor">
    {payload?.value}
  </text>
);

/**
 * Leader Portal — single teacher detail (bd-2434, NIETE port of upstream
 * bd-2393). GET /leader/teacher/:id, which is patch-membership guarded
 * server-side (a leader can only open a teacher in their own patch; anything
 * else 404s → the not-found state below).
 */
const LeaderTeacherDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // recharts needs a pixel width. ResponsiveContainer reads clientWidth, which is 0
  // under jsdom, so the chart would render nothing in test while looking fine in a
  // browser — defined but never actually drawn. Measuring here keeps it responsive AND
  // renderable, and the fallback is a readable width rather than zero.
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(640);

  useEffect(() => {
    const el = chartRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0) setChartWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [detail]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    leader
      .getTeacher(id)
      .then((d) => { if (alive) setDetail(d); })
      .catch(() => { if (alive) setNotFound(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };

  // Axis labels are formatted explicitly rather than through toLocaleDateString: the
  // axis has room for "2 Aug" and not for a locale that decides to spell it otherwise,
  // and a chart whose labels depend on the runtime locale is a chart whose tests depend
  // on the runtime locale.
  const fmtShort = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  };

  // Oldest first, unscored observations dropped. The API returns newest-first because
  // that is the right order for the list below; a trend has to read left to right in
  // time. An unscored observation is skipped rather than plotted as zero — a missing
  // score is not a bad one, and drawing it as 0% invents a collapse that never happened.
  const trend = [...(detail?.sessions ?? [])]
    .filter((s) => s.score != null)
    .reverse()
    .map((s) => ({ id: s.id, label: fmtShort(s.date), score: s.score as number }));

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-4xl px-6 py-8">
        <Link to="/portal/leader/teachers" className="text-accent text-sm font-medium flex items-center gap-1 mb-6">
          <ChevronLeft className="w-4 h-4" /> All teachers
        </Link>

        {loading ? (
          <LoadingState type="card" count={3} />
        ) : notFound || !detail ? (
          <EmptyState icon={Users} title="Teacher not found" description="This teacher isn't in your patch, or their record is unavailable." />
        ) : (
          <>
            <header className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-light">{detail.teacher.name || "Unnamed teacher"}</h1>
                <p className="text-muted-foreground mt-1">{detail.teacher.phone}</p>
              </div>
              {detail.stats.lastScore != null && <ScoreIndicator percentage={detail.stats.lastScore} size="large" />}
            </header>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <StatCard title="Coaching sessions" value={detail.stats.coachingSessions} icon={MessageSquare} />
              <StatCard title="Lesson plans" value={detail.stats.lessonPlans} icon={BookOpen} />
              <StatCard title="Reading assessments" value={detail.stats.readingAssessments} icon={FileText} />
            </div>

            {trend.length >= 2 && (
              <section
                data-testid="score-trend"
                className="bg-white rounded-lg shadow-sm border border-border mb-8 p-6"
              >
                <h2 className="text-lg font-medium mb-1">Score trend</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  {trend.length} scored observations, oldest first.
                </p>
                <div ref={chartRef} className="w-full overflow-x-auto">
                  <LineChart
                    width={chartWidth}
                    height={200}
                    data={trend}
                    margin={{ top: 8, right: 16, bottom: 8, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={<TrendTick />} tickLine={false} />
                    <YAxis domain={[0, 100]} unit="%" tickCount={5} />
                    <Tooltip formatter={(v: number) => [`${v}%`, "Score"]} />
                    <Line
                      type="monotone"
                      dataKey="score"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </div>
              </section>
            )}

            <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="p-6 pb-3">
                <h2 className="text-lg font-medium">Coaching history</h2>
              </div>
              {detail.sessions.length === 0 ? (
                <p className="px-6 pb-6 text-muted-foreground text-sm">No completed coaching sessions yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {detail.sessions.map((s) => (
                    <li key={s.id} className="flex items-center justify-between px-6 py-4">
                      <div>
                        <p className="font-medium">{fmtDate(s.date)}</p>
                        {s.points != null && s.maxPoints != null && (
                          <p className="text-muted-foreground text-sm">{s.points} / {s.maxPoints} marks</p>
                        )}
                      </div>
                      {s.score != null && <ScoreIndicator percentage={s.score} size="small" />}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </PortalLayout>
  );
};

export default LeaderTeacherDetail;
