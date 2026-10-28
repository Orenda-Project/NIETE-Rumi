import api from "../../services/api";
import type { CardFeature, FeatureGridData, ItemsData, ItemsFeature, PeriodKey, ReportsData, SchoolCardData, SessionReportData, TeacherCardData } from "./types";

/**
 * The School card's reads: GET /api/portal/coach/... (the dashboard answers 404 when the switch is off for her, when the
 * school is not hers, the teacher is not in her schools or the session is not one of her teachers'). Read only; nothing
 * here writes. Every call names the period and sends the coach's own day (`today`), like the rest of the coach app.
 */

const coachDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const get = <T>(path: string, period?: PeriodKey): Promise<T> =>
  api.get(path, { params: period ? { period, today: coachDay() } : { today: coachDay() } }).then((r) => r.data as T);

const seg = encodeURIComponent;

export const card = {
  school: (emis: string, period: PeriodKey) => get<SchoolCardData>(`/coach/school/${seg(emis)}/card`, period),
  grid: (emis: string, feature: CardFeature, period: PeriodKey) => get<FeatureGridData>(`/coach/school/${seg(emis)}/feature/${seg(feature)}`, period),
  teacher: (ext: string, period: PeriodKey) => get<TeacherCardData>(`/coach/teacher/${seg(ext)}/card`, period),
  items: (ext: string, feature: ItemsFeature, period: PeriodKey) => get<ItemsData>(`/coach/teacher/${seg(ext)}/items/${seg(feature)}`, period),
  reports: (ext: string, period: PeriodKey) => get<ReportsData>(`/coach/teacher/${seg(ext)}/reports`, period),
  session: (id: string) => get<SessionReportData>(`/coach/session/${seg(id)}`),
};
