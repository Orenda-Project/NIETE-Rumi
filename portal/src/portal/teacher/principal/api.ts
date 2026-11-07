import api from "../../services/api";
import type { ActivityTile, CardTeacher, Overview, Period, PeriodKey, SchoolPrincipal } from "../../coach/card/types";

/**
 * bd-33wxxi.2 — GET /api/portal/principal/school/card (dashboard/routes/portal-principal.routes.js): the principal's OWN
 * school's card, the coach School Card's numbers read through her users.school_id. The school is the server's (her
 * session); nothing here names one. Counts only (#55 Q1): the DC and coach boxes are how many and by how many teachers.
 * `school: null` when her row names no school. Read only.
 */
export type PrincipalSchoolCard = {
  school: { emis: string | null; name: string; teachers: number; roster?: number; lastVisitDaysAgo: number | null; principals?: SchoolPrincipal[] } | null;
  period?: Period;
  overview?: Overview;
  tiles?: ActivityTile[];
  teachers?: CardTeacher[];
  scores?: Record<"dc" | "coach", { count: number; makers: number }>;
  level?: string | null;
  levels?: Partial<Record<"PRIMARY" | "MIDDLE" | "HIGH", number>>;
};

export function getPrincipalSchoolCard(period: PeriodKey = "week"): Promise<PrincipalSchoolCard> {
  return api.get("/principal/school/card", { params: { period } }).then((r) => r.data as PrincipalSchoolCard);
}
