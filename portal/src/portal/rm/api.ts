/**
 * bd-sex15q.17 — the RM screens' client for /api/portal/coachip/rm/* (contracts/API.md v1.4 R17-R21) and /coachip/me.
 * The house axios client (same-origin cookie session). Path ids are a coach's users.id only (coaches are staff); no
 * teacher reference is ever sent or received. POST bodies carry exactly the contract's keys (A11): a note is a
 * template, a W, one to three schools and a date, never words.
 */
import api from "../services/api";
import type { Me, Note } from "../coach/insights/types";
import type { CircleMomentDetail, RmCircle, RmCoach, RmHome, RmNoteBody, SectorStep } from "./types";

export const rm = {
  me: (): Promise<Me> => api.get("/coachip/me").then((r) => r.data),
  home: (): Promise<RmHome> => api.get("/coachip/rm/home").then((r) => r.data),
  coach: (coachUserId: string): Promise<RmCoach> => api.get(`/coachip/rm/coach/${encodeURIComponent(coachUserId)}`).then((r) => r.data),
  /** R6 for an RM: only a moment in this sector's circle (circleAllows); the circle form (no code, no session, API §9.6).
   *  `as: "rm"` asks in RM context, so a dual who also coaches that school never gets the coach form (fix-r5 s5, B22). */
  moment: (momentId: string): Promise<CircleMomentDetail> =>
    api.get(`/coachip/m/${encodeURIComponent(momentId)}`, { params: { as: "rm" } }).then((r) => r.data),
  circle: (): Promise<RmCircle> => api.get("/coachip/rm/circle").then((r) => r.data),
  sendNote: (b: RmNoteBody): Promise<{ note: Note }> => {
    const body: RmNoteBody = { coach_user_id: b.coach_user_id, template_id: b.template_id, w_id: b.w_id, school_ids: [...b.school_ids], due_on: b.due_on };
    return api.post("/coachip/rm/notes", body).then((r) => r.data);
  },
  setSectorStep: (b: { i_id: string; w_id: string; date: string }): Promise<{ step: SectorStep }> =>
    api.post("/coachip/rm/steps", { i_id: b.i_id, w_id: b.w_id, date: b.date }).then((r) => r.data),
};
