import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Users, MessageSquare, BookOpen, TrendingUp, ChevronRight, UserCheck, GraduationCap } from "lucide-react";
import { leader } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import PortalLayout from "../components/PortalLayout";
import StatCard from "../components/StatCard";
import LoadingState from "../components/LoadingState";
import type { LeaderOverview } from "../types/portal";
import { useCoachV2, isCoachV2For } from "../coach/useCoachV2";
import { useTeacherV2, isTeacherV2For } from "../teacher/useTeacherV2";
import { teacherPath } from "../teacher/routes";
import FlnSendCard from "../fln/FlnSendCard";
// bd-tacnwy — internal testers only (portal_role_switch): a principal lands here, so she can switch back from here.
import RoleSwitch from "../teacher/roleSwitch/RoleSwitch";
import { NoSchoolNotice } from "../teacher/principal/NoSchool";
import { principalOf } from "../lib/leaderRole";
import { useCopy } from "../teacher/i18n";
import { COACH_TRAINING } from "../coach/coachTraining/copy";
import { PRINCIPAL_TRAINING_PATH } from "../coach/coachTraining/audience";

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
  // bd-o15qnr — a coach in the v2 pilot lands on the v2 Home instead.
  const coachV2 = isCoachV2For(user, useCoachV2(user?.phoneNumber || null, !!user));
  // A principal on the teacher app v2 lands on its Home (she gets the teacher app, plus her school).
  const teacherV2 = isTeacherV2For(user, useTeacherV2(user?.phoneNumber || null, !!user));
  const name = user?.firstName?.trim();
  // bd-v04lsh (queue #257) — Principal Training reaches a principal on My Patch here (no app Home, so no tile).
  const principal = principalOf(user);
  const T = useCopy(COACH_TRAINING);
  const [overview, setOverview] = useState<LeaderOverview | null>(null);
  // bd-r2uzg1.21.4 — a principal whose account names no school: her patch is empty for that reason, so the page says
  // so (and what to do) instead of zero tiles. The server's word, from her own row.
  const [noSchool, setNoSchool] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    leader
      .getOverview()
      .then((d) => { if (alive) { setOverview(d.overview); setNoSchool(d.noSchool === true); } })
      .catch(() => { if (alive) setOverview(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (coachV2) return <Navigate to="/portal/coach" replace />;
  if (teacherV2) return <Navigate to={teacherPath("home")} replace />;

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

        {/* bd-v04lsh (queue #257): the operator, 24 Nov 2026, "Coach Trainings needs to go live for Principal as well.
            Showing as Principal Training." One card for a principal, above her patch and whatever it says (no school
            too): the ten modules are hers, not her school's. The leader menu is untouched (its snapshot pins it). */}
        {principal && (
          <Link
            to={PRINCIPAL_TRAINING_PATH}
            data-testid="principal-training-card"
            className="mb-8 flex min-h-[64px] items-center gap-4 rounded-lg border border-border bg-white p-4 shadow-sm transition-colors hover:bg-muted/40"
          >
            <GraduationCap className="h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
            <span className="flex-1">
              <span className="block text-lg font-medium">{T.principalTitle}</span>
              <span className="block text-sm text-muted-foreground">{T.coachIntro}</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
          </Link>
        )}

        {loading ? (
          <LoadingState type="card" count={4} />
        ) : noSchool ? (
          <NoSchoolNotice testId="patch-no-school" />
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

            {/* one tile per STEPS feature, so the patch can be read
                feature by feature. Each shows REACH (how many teachers have
                used it) over the total, not just a volume: 21 registers across
                19 teachers reads healthy until you learn one teacher took all
                21, and the total alone cannot tell those apart. */}
            <div className="grid grid-cols-2 gap-4 mb-8" data-testid="feature-reach">
              <StatCard
                title="Marking attendance"
                value={`${overview.teachersMarkingAttendance}/${overview.totalTeachers}`}
                icon={UserCheck}
              />
              <StatCard
                title="In training"
                value={`${overview.teachersInTraining}/${overview.totalTeachers}`}
                icon={GraduationCap}
              />
            </div>
            <FlnSendCard />

            {/* the "Average recent coaching score" panel is gone.
                It was the headline number against which teachers were read, and
                it is the thing this ticket hides. The score is still computed
                and still on the payload; a leader simply no longer reads it.
                School-level numbers live on Analytics, where they are labelled. */}

            {/* Focus list — where attention pays off most */}
            <section className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
              <div className="p-6 pb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-medium">Needs attention</h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    {/* the ORDER is still by lowest recent score —
                        that is computation and it stays. The copy no longer
                        names a number the reader cannot see on this page. */}
                    Where coaching time pays off most, based on the most recent visit.
                  </p>
                </div>
                <Link to="/portal/leader/teachers" className="text-accent text-sm font-medium flex items-center gap-1">
                  All teachers <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              {overview.focus.length === 0 ? (
                <p className="px-6 pb-6 text-muted-foreground text-sm">
                  No completed visits yet — nothing to flag.
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
                          {/* The named area, not a number: "what to work on"
                              is the actionable half of what the score implied. */}
                          {t.focusArea && (
                            <span className="text-sm text-accent max-w-[14rem] truncate" title={t.focusArea}>
                              {t.focusArea}
                            </span>
                          )}
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
        <RoleSwitch className="mt-8 max-w-md" />
      </div>
    </PortalLayout>
  );
};

export default LeaderHome;
