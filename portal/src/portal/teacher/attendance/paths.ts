import { featurePath } from '../paths';

/** bd-fmf24g.7 — where each teacher v2 Attendance page lives (all under /portal/teacher/attendance). */
export const ATTENDANCE_V2_BASE = featurePath('attendance');

const enc = encodeURIComponent;

/** The roll call for one class (?date= picks a day other than today). */
export const markPath = (listId: string, date?: string) =>
  `${ATTENDANCE_V2_BASE}/${enc(listId)}/mark${date ? `?date=${enc(date)}` : ''}`;
/** One class's month: calendar, a day's detail, each child's %. */
export const viewPath = (listId: string, month?: string) =>
  `${ATTENDANCE_V2_BASE}/${enc(listId)}/view${month ? `?month=${enc(month)}` : ''}`;
/** One class's month register. */
export const downloadPath = (listId: string) => `${ATTENDANCE_V2_BASE}/${enc(listId)}/download`;
