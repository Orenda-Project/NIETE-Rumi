import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { ObserveRoutesProvider, type ObserveRoutes, type VisitPageData } from "../../coach/observe/observeRoutes";
import { coach } from "../../services/api";
import { karachiDay } from "../../coach/time";
import type { CoachVisit } from "../../coach/types";
import type { ObservationScreen } from "../../coach/reports/paths";
import { OBS_HOME } from "../observations/paths";
import { getPrincipalSchoolCard } from "./api";
import { usePrincipalAppState } from "./usePrincipalApp";

/**
 * bd-33wxxi.4 — a principal observing one of her teachers (#55 P3, Observations A), on the coach's own Observe and
 * observation screens. What differs is only where they take their visit and their links from (coach/observe/
 * observeRoutes): no coach gate (the teacher app's TeacherGate ran), and no scheduled visit — the teacher she picked,
 * read from her own school's card (GET /principal/school/card), stands in for one. No observation_schedules row is ever
 * made, so no visit notice goes to the teacher; the server binds the recording to the teacher through the principal's
 * own roster (bot patch-resolver: her school, never herself, never another principal).
 */
const BASE = "/portal/teacher/principal";
const seg = encodeURIComponent;

export const PRINCIPAL_PICK = `${BASE}/pick`;
/** bd-33wxxi.9.3 — the picked teacher's page: the coach's visit screen (Start recording / Upload recording, the Teacher card). */
export const principalVisitPath = (ext: string) => `${BASE}/visit/${seg(ext)}`;
export const principalCheckPath = (ext: string) => `${BASE}/observe/${seg(ext)}`;
export const principalObservationPath = (id: string, screen?: ObservationScreen) =>
  `${BASE}/observation/${seg(id)}${screen ? `/${screen}` : ""}`;

/** The picked teacher as the visit the coach's screens expect: today, nothing scheduled, still to do. */
export async function principalVisit(ext: string): Promise<{ visit: CoachVisit | null }> {
  return principalVisitFrom(await getPrincipalSchoolCard("week"), ext);
}

/**
 * bd-33wxxi.9.3 — the picked teacher's page (the coach's visit screen): the visit as above, her row's counts for this week,
 * and when the principal last observed her (her own observations, newest first; a failed read = not shown as observed).
 */
export async function principalVisitPage(ext: string): Promise<VisitPageData> {
  const [card, reports] = await Promise.all([
    getPrincipalSchoolCard("week"),
    coach.getReports({ page: 1 }).catch(() => null),
  ]);
  const { visit } = principalVisitFrom(card, ext);
  if (!visit) return { visit: null };
  const t = (card.teachers ?? []).find((x) => x.teacherExtId === ext);
  const last = (reports?.all.items ?? []).find((r) => r.teacherExtId === ext);
  return { visit, counts: t?.counts ?? null, lastObservedAt: last?.createdAt ?? null };
}

function principalVisitFrom(card: Awaited<ReturnType<typeof getPrincipalSchoolCard>>, ext: string): { visit: CoachVisit | null } {
  const t = (card.teachers ?? []).find((x) => x.teacherExtId === ext);
  if (!card.school || !t) return { visit: null };
  return {
    visit: {
      id: ext,
      teacherExtId: ext,
      teacherName: t.name,
      schoolName: card.school.name,
      schoolExtId: card.school.emis ? `niete:${card.school.emis}` : null,
      scheduledFor: karachiDay(),
      scheduledSlot: null,
      status: "upcoming",
    },
  };
}

export const PRINCIPAL_OBSERVE_ROUTES: ObserveRoutes = {
  coachGate: false,
  showScores: false,
  loadVisit: principalVisit,
  loadVisitPage: principalVisitPage,
  // bd-33wxxi.9.3 — Back from her recording screens is the picked teacher's page (the coach's visit screen), whose own
  // Back is Pick the teacher. No Reschedule / Cancel visit: there is no visit.
  visit: principalVisitPath,
  visitActions: false,
  visitBack: () => PRINCIPAL_PICK,
  record: (ext) => `${principalCheckPath(ext)}/record`,
  attach: (ext) => `${principalCheckPath(ext)}/attach`,
  check: principalCheckPath,
  sending: (ext) => `${principalCheckPath(ext)}/sending`,
  observation: principalObservationPath,
  reports: OBS_HOME,
};

/**
 * A principal-app screen: the coach screen inside the principal's routes. Anyone else (a teacher, a principal the
 * switch does not name) goes to Observations, as if the page did not exist. Nothing renders while /config is read.
 */
export function PrincipalObserve({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const on = usePrincipalAppState(user);
  if (loading || on === null) return null;
  if (!on) return <Navigate to={OBS_HOME} replace />;
  return <ObserveRoutesProvider value={PRINCIPAL_OBSERVE_ROUTES}>{children}</ObserveRoutesProvider>;
}
