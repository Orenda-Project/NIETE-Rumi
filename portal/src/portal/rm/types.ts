/**
 * bd-sex15q.17 — the RM payloads (contracts/API.md v1.4 §9 R17-R21, §3 Coach, SectorStep). The shared fragments
 * (Window, Count, WRow, Note, School, Text, Empty) are the coach kit's, imported, never redeclared. Nothing here can
 * hold a teacher: no Code, no code_id, no session id (B1, B21, B22).
 */
import type { Count, Empty, ISODate, ISOTime, Note, School, Text, UUID, Visit, Window, WRow } from "../coach/insights/types";

export type NeedsMeReason = "unvisited" | "no_steps" | "checks_overdue";

export type Coach = {
  coach_user_id: UUID;
  coach_label: string;
  activity: { schools_unvisited: Count; debriefs_with_step: Count; checks_overdue: Count };
  needs_me_reason: NeedsMeReason | null;
  note_open: Note | null;
};

export type SectorMove = { row: WRow; by_school: { school: School; count: Count }[]; agenda: boolean; coach_count: number; coaches_with_5plus: number };

export type TemplateId = "RM-T1" | "RM-T2" | "RM-T3" | "RM-T4";

/** R17 GET /coachip/rm/home (S8). */
export type RmHome = {
  sector: string;
  window: Window;
  windows: Window[];
  opening: { visited: Count; unobserved_schools: Count; unobserved_codes: Count; floor_weeks: 4 };
  moves: SectorMove[];
  groups: { needs_me: Coach[]; on_track: Coach[] };
  on_track_count: Count;
  no_scope_coaches: Count;
  unassigned_schools: Count;
  circle: { moments: Count; checks_due: Count };
  cluster: { i_id: string; title: Text; date: ISODate | null } | null;
  monday: { templates: { template_id: TemplateId; title: Text }[] };
  stale: { as_of: ISODate; reason: "failed" | "pending" } | null;
  empty: Empty | null;
  computed_at: ISOTime;
};

/** R18 GET /coachip/rm/coach/:coachUserId (S9). */
export type RmCoach = {
  coach: Coach;
  schools: { school: School; last_visit: ISODate | null; next_visit: Visit | null; graded: Count; weeks_since_visit: number | null }[];
  steps: { open: Count; completed: Count; overdue: Count };
  moves: { row: WRow; sector: Count | null }[];
  notes: Note[];
  calibration: { status: "later_bead" };
  windows: Window[];
  computed_at: ISOTime;
};

/** R20 GET /coachip/rm/circle (S10). B22: a moment is coach · school · W, nothing else. */
export type CircleMoment = { coach_user_id: UUID; coach_label: string; moment_id: UUID; w_id: string; short_name: Text; school: School; duration_s: number };

export type RmCircle = {
  week_start: ISODate;
  /** SPEC v2.1 §11.1: "coach" when the sector is under the B23 floor and each clip is that coach's own first move. */
  basis: "sector" | "coach";
  /** The B23 floor's coach count, a Count on the sector's 4-week window (`window_id`, in `windows`); null on a "sector" week. */
  /** `coaches_ranked`: the sector's coaches with an ok coach-level rank-1 W (picks the empty line; never drawn as a number). */
  floor: { coaches_with_5plus: number; needed: 3; coaches_ranked?: number; window_id: string } | null;
  window: Window;
  sector_interventions: { i_id: string; title: Text; level: "sector" | "school"; date: ISODate | null; attendees: Text; check: Text }[];
  moments: CircleMoment[];
  checks_due: { coach_label: string; count: Count }[];
  windows: Window[];
  computed_at: ISOTime;
};

/** R19 POST /coachip/rm/notes: exactly these keys (API A11); the server composes the lines. */
export type RmNoteBody = { coach_user_id: UUID; template_id: TemplateId; w_id: string; school_ids: UUID[]; due_on: ISODate };

/** R21 POST /coachip/rm/steps (API A9). */
export type SectorStep = {
  id: UUID; scope: "sector"; sector: string; w_id: string; i_id: string; title: Text; date: ISODate;
  status: "open" | "completed" | "deferred" | "cancelled";
};

/** R6 as an RM reads it (API §9.6, fixtures `moment_rm`): the circle form. Only the fields S10 shows are typed. */
export type CircleMomentDetail = {
  moment_id: UUID;
  school: School;
  w: { w_id: string; short_name: Text; sentence: Text };
  lesson_s: number | null;
  clip: { from_s: number; to_s: number; duration_s: number; status: "ready" | "pending" | "failed" | "expired" };
  gloss: Text | null;
  gloss_status: string;
};
