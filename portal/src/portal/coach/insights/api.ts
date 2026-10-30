/**
 * bd-sex15q.15 — the coach screens' client for /api/portal/coachip/* (contracts/API.md v1.4, routes R1-R6, R9-R15).
 * The house axios client (same-origin cookie session). Ids travel in paths only as the API allows (a W id, a moment
 * or step uuid); a teacher's `code_id` only ever in a POST body (B21). No response is cached (Cache-Control no-store).
 */
import api from "../../services/api";
import { forgetPrimed, primeRead, primeWhenCoachipOn, takePrimed } from "@/lib/bootReads";
import type { Home, Me, MomentsFeed, MoveDetail, Note, Results, SchoolsList, Stats, Step, WDetail } from "./types";

const readHome = (): Promise<Home> => api.get("/coachip/home").then((r) => r.data);

/**
 * bd-sex15q.34 (COS 105750) — on a coach's first open, This week's /coachip/home starts as soon as /config says the
 * switch is on (App.tsx, through lib/bootReads), instead of after the page's chunks and gate. The page takes that
 * request once (if it is under 30 s old); every other read asks as before. Primed ONLY on a literal
 * `features.coachip === true`, so a switch-off coach still makes zero /coachip/ requests.
 */
export const HOME_KEY = "coachip/home";
export const primeHome = (): void => primeRead(HOME_KEY, readHome);
export const forgetPrimedHome = (): void => forgetPrimed(HOME_KEY);
export const primeHomeWhenOn = (readConfig: () => Promise<{ features?: unknown } | null>): Promise<void> =>
  primeWhenCoachipOn(readConfig, primeHome);

export const coachip = {
  me: (): Promise<Me> => api.get("/coachip/me").then((r) => r.data),
  home: (): Promise<Home> => takePrimed<Home>(HOME_KEY) ?? readHome(),
  w: (wId: string): Promise<WDetail> => api.get(`/coachip/w/${encodeURIComponent(wId)}`).then((r) => r.data),
  schools: (): Promise<SchoolsList> => api.get("/coachip/schools").then((r) => r.data),
  moments: (q: { w?: string | null; week?: string | null } = {}): Promise<MomentsFeed> => {
    const params: Record<string, string> = {};
    if (q.w) params.w = q.w;
    if (q.week) params.week = q.week;
    return api.get("/coachip/moments", { params }).then((r) => r.data);
  },
  move: (wId: string, schoolId?: string | null): Promise<MoveDetail> =>
    api.get(`/coachip/i/${encodeURIComponent(wId)}`, { params: schoolId ? { school: schoolId } : {} }).then((r) => r.data),
  stats: (): Promise<Stats> => api.get("/coachip/stats").then((r) => r.data),
  results: (): Promise<Results> => api.get("/coachip/results").then((r) => r.data),
  setStep: (body: { code_id: string; school_id: string; w_id: string; i_id: string; source_session_id: string | null; rm_note_id: string | null }):
    Promise<{ step: Step }> => api.post("/coachip/steps", body).then((r) => r.data),
  tick: (stepId: string, coach_tick: "yes" | "no"): Promise<{ step: Step }> =>
    api.post(`/coachip/steps/${encodeURIComponent(stepId)}/tick`, { coach_tick }).then((r) => r.data),
  stepStatus: (stepId: string, status: "completed" | "deferred" | "cancelled"): Promise<{ step: Step }> =>
    api.post(`/coachip/steps/${encodeURIComponent(stepId)}/status`, { status }).then((r) => r.data),
  noteStatus: (noteId: string, status: "seen" | "dismissed"): Promise<{ note: Note }> =>
    api.post(`/coachip/notes/${encodeURIComponent(noteId)}/status`, { status }).then((r) => r.data),
  /** R16 (fix-r5 s6 b): the one route that answers a name; the code_id travels in the body only (B21). Never cached. */
  teacherName: (codeId: string): Promise<{ name: string }> =>
    api.post("/coachip/teacher-name", { code_id: codeId }).then((r) => r.data),
};

/** Where an error leaves a screen (COPY §E). */
export type LoadError = "not_found" | "signed_out" | "offline" | "failed";

export function errorKind(e: unknown): LoadError {
  const status = (e as { response?: { status?: number } })?.response?.status;
  if (status === 404) return "not_found";
  if (status === 401) return "signed_out";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return "failed";
}

/** A 409 from POST /coachip/steps: this coach already has an open step for that code and move. */
export function isStepConflict(e: unknown): boolean {
  const r = (e as { response?: { status?: number; data?: { error?: string } } })?.response;
  return r?.status === 409 && r.data?.error === "step_exists";
}
