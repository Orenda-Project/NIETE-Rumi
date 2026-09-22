import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ChevronLeft, MessageSquare, BookOpen, FileText, Users } from "lucide-react";
import { leader } from "../services/api";
import PortalLayout from "../components/PortalLayout";
import StatCard from "../components/StatCard";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";
import type { LeaderTeacherDetail as Detail } from "../types/portal";

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
            </header>

            {/* the written feedback that replaces the score. The
                number is still computed and still on the payload; a leader
                simply no longer reads it. This is what she reads instead. */}
            {detail.stats.lastSummary && (
              <section
                data-testid="latest-feedback"
                className="bg-white rounded-lg p-6 shadow-sm border border-border mb-8"
              >
                <h2 className="text-lg font-medium mb-2">Latest feedback</h2>
                <p className="text-muted-foreground leading-relaxed">{detail.stats.lastSummary}</p>
              </section>
            )}

            <div className="grid grid-cols-3 gap-4 mb-8">
              <StatCard title="Coaching sessions" value={detail.stats.coachingSessions} icon={MessageSquare} />
              <StatCard title="Lesson plans" value={detail.stats.lessonPlans} icon={BookOpen} />
              <StatCard title="Reading assessments" value={detail.stats.readingAssessments} icon={FileText} />
            </div>

            {/* the score-trend chart is gone from the leader view. It
                plotted the very number this ticket hides, so keeping it would
                have handed back the score as a picture. The trend still exists
                for the teacher's own analytics, where it was never in question. */}

            <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="p-6 pb-3">
                <h2 className="text-lg font-medium">Coaching history</h2>
              </div>
              {detail.sessions.length === 0 ? (
                <p className="px-6 pb-6 text-muted-foreground text-sm">No completed coaching sessions yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {detail.sessions.map((s) => (
                    <li key={s.id} data-testid={`session-${s.id}`} className="px-6 py-4">
                      <p className="font-medium">{fmtDate(s.date)}</p>
                      {/* No marks, no percentage: the written note IS the
                          record of the visit now. A session with none says so
                          rather than rendering a heading over nothing. */}
                      {s.summary ? (
                        <p className="text-muted-foreground text-sm mt-1 leading-relaxed">{s.summary}</p>
                      ) : (
                        <p className="text-muted-foreground text-sm mt-1 italic">No written feedback for this visit.</p>
                      )}
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
