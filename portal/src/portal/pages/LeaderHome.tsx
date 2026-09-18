import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, MessageSquare, BookOpen, TrendingUp, ChevronRight } from "lucide-react";
import { leader } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import PortalLayout from "../components/PortalLayout";
import StatCard from "../components/StatCard";
import LoadingState from "../components/LoadingState";
import ScoreIndicator from "../components/ScoreIndicator";
import type { LeaderOverview } from "../types/portal";

/**
 * Leader Portal — "My Patch" home (bd-2434, NIETE port of upstream bd-2391).
 *
 * Greets the leader BY NAME inside the shared portal shell — which renders the
 * NIETE logo/branding and the role-gated leader nav — then shows the patch
 * KPIs + a focus list from GET /leader/overview. NIETE leaders are ICT coaches;
 * the greeting stays 'Assalam-o-alaikum'.
 */
const LeaderHome = () => {
  const { user } = useAuth();
  const name = user?.firstName?.trim();
  const [overview, setOverview] = useState<LeaderOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    leader
      .getOverview()
      .then((d) => { if (alive) setOverview(d.overview); })
      .catch(() => { if (alive) setOverview(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <PortalLayout>
      <div className="container mx-auto max-w-7xl px-6 py-8">
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-light">
            {name ? `Assalam-o-alaikum, ${name}` : "Assalam-o-alaikum"}
          </h1>
          <p className="text-muted-foreground mt-2">
            Here's your patch — the teachers and schools you support.
          </p>
        </header>

        {loading ? (
          <LoadingState type="card" count={4} />
        ) : !overview ? (
          <section className="bg-white rounded-lg p-6 shadow-sm border border-border">
            <p className="text-muted-foreground">Your patch overview isn't available right now.</p>
          </section>
        ) : (
          <>
            {/* Headline KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard title="Teachers" value={overview.totalTeachers} icon={Users} />
              <StatCard title="On NIETE" value={`${overview.onRumi}/${overview.totalTeachers}`} icon={TrendingUp} />
              <StatCard title="Coaching sessions" value={overview.totalCoachingSessions} icon={MessageSquare} />
              <StatCard title="Lesson plans" value={overview.totalLessonPlans} icon={BookOpen} />
            </div>

            {/* Average recent score */}
            {overview.avgLastScore != null && (
              <section className="bg-white rounded-lg p-6 shadow-sm border border-border mb-8 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-medium">Average recent coaching score</h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    Across {overview.scoredTeachers} teacher{overview.scoredTeachers === 1 ? "" : "s"} with a recent session.
                  </p>
                </div>
                <ScoreIndicator percentage={overview.avgLastScore} size="large" />
              </section>
            )}

            {/* Focus list — where attention pays off most */}
            <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="p-6 pb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-medium">Needs attention</h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    Teachers with the lowest recent coaching scores.
                  </p>
                </div>
                <Link to="/portal/leader/teachers" className="text-accent text-sm font-medium flex items-center gap-1">
                  All teachers <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              {overview.focus.length === 0 ? (
                <p className="px-6 pb-6 text-muted-foreground text-sm">
                  No coaching scores yet — nothing to flag.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.focus.map((t) => (
                    <li key={t.rumiUserId || t.phone}>
                      <Link
                        to={t.rumiUserId ? `/portal/leader/teacher/${t.rumiUserId}` : "/portal/leader/teachers"}
                        className="flex items-center justify-between px-6 py-4 hover:bg-muted/40 transition-colors"
                      >
                        <div>
                          <p className="font-medium">{t.name || "Unnamed teacher"}</p>
                          <p className="text-muted-foreground text-sm">
                            {t.coachingSessions} session{t.coachingSessions === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {t.lastScore != null && <ScoreIndicator percentage={t.lastScore} size="small" />}
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </Link>
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

export default LeaderHome;
