/**
 * bd-sex15q.15 — COACHIP: the coach insight screens' wire shapes, verbatim from contracts/API.md v1.4 §3 and §7 (the
 * contract wins over this file; a change there is a change here). One client file for the shapes: the player
 * (insights/player, m-player) imports from it too.
 *
 * Nothing here can hold a teacher's name, phone, users.id or key: the only teacher reference is `Code` (B21).
 */

export type UUID = string;
/** YYYY-MM-DD, an Asia/Karachi calendar day. */
export type ISODate = string;
/** ISO 8601 UTC. */
export type ISOTime = string;

/** Words the server composed, in both languages; the client shows one by the page's language. */
export type Text = { en: string; ur: string };

export type Framework = "lp_fidelity" | "fico_v3" | "fico_v4" | "fico17" | "coachip_detector" | "egra" | "activity";

export type Window = {
  id: string;
  from: ISODate;
  to: ISODate;
  weeks: 1 | 4 | 8 | null;
  grader: string | null;
  grader_label: Text | null;
  framework: Framework;
  scoring_changed_on: ISODate | null;
};

/** Never a bare number: n of d, d owned by the server, over a window listed in the same payload. */
export type Count = { n: number; d: number; window_id: string };
/** A derived statistic: its base is said once as a clause. */
export type Stat = { kind: "median" | "mean"; value: number; unit: "min" | "s"; base: number; window_id: string };
export type Code = { code_id: UUID; code: string };
export type School = { school_id: UUID; school_name: string };
export type Visit = { date: ISODate; schedule_id: UUID };

export type WCard = {
  w_id: string;
  parent_w_id: string | null;
  rank: 1 | 2;
  short_name: Text;
  number_line: Text;
  sentence: Text;
  cause: { text: Text; stat: Stat; also: { text: Text; count: Count } | null } | null;
  count: Count;
  teacher_count: number;
  teachers: Count;
  window: Window;
  status: "ok" | "insufficient" | "failed";
  where_first: { school: School; count: Count; visit: Visit | null; then: School[] } | null;
  moment_id: UUID | null;
  moment_duration_s: number | null;
  i_id: string | null;
};

export type WRowState = "ranked" | "also_seen" | "not_yet";

export type WRow = {
  w_id: string;
  short_name: Text;
  sentence: Text;
  count: Count | null;
  window: Window;
  state: WRowState;
  where_first: { school: School; count: Count } | null;
  not_yet: { graded: Count | null; codes_seen: number; codes_needed: 3; coaches_with_5plus: number | null } | null;
  sector: Count | null;
};

export type StripHit = { session_id: UUID; hit: true | false | "partial"; recorded_on: ISODate };

export type Step = {
  id: UUID;
  scope: "coach";
  code: Code;
  school: School;
  w_id: string;
  i_id: string;
  step: Text;
  set_on: ISODate;
  check_by: ISODate;
  check_rule: "visit" | "14_days";
  visit: Visit | null;
  status: "open" | "completed" | "deferred" | "cancelled";
  coach_tick: "pending" | "yes" | "no";
  strip: { needed: 3; window_days: 14; hits: StripHit[] };
  chip: "to_come" | "worked" | "not_yet";
  to_come: number;
  rm_note_id: UUID | null;
};

export type Note = {
  id: UUID;
  label: Text;
  template_id: "RM-T1" | "RM-T2" | "RM-T3" | "RM-T4";
  w_id: string;
  lines: { en: [string, string, string]; ur: [string, string, string] };
  schools: School[];
  due_on: ISODate;
  status: "sent" | "seen" | "set" | "dismissed";
};

export type Empty = {
  status: "insufficient" | "pending" | "failed" | "no_scope";
  message: Text;
  detail: { graded: Count | null; widened_to_weeks: 8 | null; as_of: ISODate | null };
};

export type Verdict = "executed" | "partial" | "not_done" | "not_adjudicable" | "substituted" | "not_reached";

export type MomentStep = { phase: string; label: Text; verdict: Verdict; from_s: number | null; to_s: number | null };

export type Moment = {
  moment_id: UUID;
  session: { session_id: UUID; grade: number | null; subject: string | null; recorded_on: ISODate; duration_s: number };
  code: Code;
  school: School;
  w: { w_id: string; short_name: Text; sentence: Text };
  kind: "missing" | "good" | "phonics";
  steps: MomentStep[];
  lesson_s: number | null;
  confidence: "high" | "medium" | "none";
  clip: { from_s: number; to_s: number; duration_s: number; status: "ready" | "pending" | "failed" | "expired" };
  gloss: Text | null;
  gloss_status: "ok" | "blocked" | "failed" | "not_applicable" | "pending" | "not_evaluated" | "paused";
  question: Text;
  pair: Moment | { library_clip: { clip_id: string; title: Text; duration_s: number } } | null;
  full_recording: { duration_s: number } | null;
};

/* ── R2 GET /coachip/home (S1) ───────────────────────────────────────────── */
export type Home = {
  window: Window;
  windows: Window[];
  moves: [] | [WCard] | [WCard, WRow];
  note: Note | null;
  steps: Step[];
  coverage: { recordings: Count };
  not_yet: WRow[];
  phonics: {
    status: "testing" | "ok" | "paused";
    read: number;
    needed: 30;
    kappa_passed: boolean;
    card: WCard | null;
    reading_hours: Count | null;
  };
  stale: { as_of: ISODate; reason: "failed" | "pending" } | null;
  empty: Empty | null;
  method: { hysteresis_applied: boolean; query_id: string };
  computed_at: ISOTime;
};

/* ── R3 GET /coachip/w/:wId (S2 + S3) ────────────────────────────────────── */
export type WSchool = {
  school: School;
  count: Count;
  last_visit: ISODate | null;
  next_visit: Visit | null;
  state: "shows" | "too_few" | "does_not_show" | "no_graded";
  codes: { code: Code; graded: Count; strip: { session_id: UUID; shows: true | false | "partial" }[] | null }[];
};

export type StepCard = {
  i_id: string;
  title: Text;
  teacher_step: Text;
  check_line: Text;
  check_by: { date: ISODate; rule: "visit" | "14_days" };
  code: Code | null;
  visit: Visit | null;
};

export type WDetail = {
  card: WCard;
  split: WRow[];
  good_looks_like: Text;
  schools: WSchool[];
  schools_not_showing: Count;
  moment: Moment | null;
  step_card: StepCard | null;
  excluded: { mismatch: number; unusable: number; duplicates: number; failed: number };
  method: { query_id: string; grader: string; framework: string; window: Window; coverage: Count; caveats: Text[]; current_school_rule: Text };
  windows: Window[];
  computed_at: ISOTime;
};

/* ── R4 GET /coachip/schools ─────────────────────────────────────────────── */
export type SchoolsList = {
  window: Window;
  schools: { school: School; top_w: WRow | null; last_visit: ISODate | null; next_visit: Visit | null; graded: Count }[];
  windows?: Window[];
  computed_at: ISOTime;
};

/* ── R5 GET /coachip/moments (Listen) ────────────────────────────────────── */
export type MomentsFeed = {
  window: Window;
  base: Count;
  recordings: Count;
  filters: { w_id: string; short_name: Text; count: Count }[];
  moments: Moment[];
  failed_sessions: { session_id: UUID; school: School; recorded_on: ISODate; duration_s: number }[];
  windows: Window[];
  computed_at: ISOTime;
};

/* ── R9 GET /coachip/i/:wId (S5) ─────────────────────────────────────────── */
export type Intervention = {
  i_id: string;
  title: Text;
  teacher_action_step: Text;
  with_whom: Text;
  duration: Text;
  materials: { kind: "vidrec" | "fln" | "print" | "other" | "none"; ref: string | null; title: Text }[];
  rehearsal_script: Text;
  debrief_script: Text;
  listen_for: Text;
  check_it_worked: Text;
  evidence: { source: string; claim: Text }[];
  library_version: string;
};

export type MoveDetail = {
  w: WCard;
  i: Intervention | null;
  alternatives: { i_id: string; title: Text }[];
  check_by_default: { date: ISODate; rule: "visit" | "14_days"; visit: Visit | null };
  fln: { can_send: boolean; plan_ids: string[] } | null;
  windows: Window[];
  computed_at: ISOTime;
};

/* ── R14 GET /coachip/stats (S6) ─────────────────────────────────────────── */
export type StatsRow = {
  w_id: string;
  short_name: Text;
  sentence: Text;
  now: Count;
  before: Count | null;
  change: "fewer" | "more" | "same" | null;
  sector: Count | null;
  status: "ok" | "insufficient" | "failed";
};

export type Stats = {
  window_pair: { now: Window; before: Window | null };
  rows: StatsRow[];
  opening: { state: "first_window" | "two_windows" | "marker"; first_trend_after: ISODate; scoring_changed_on: ISODate | null };
  fico_panel: { indicator: string; label: Text; lowest_share: Count }[];
  recordings_by_week: { week_start: ISODate; graded: Count }[];
  coverage: Count;
  method: { query_id: string; grader: string; framework: string; caveats: Text[] };
  windows: Window[];
  computed_at: ISOTime;
};

/* ── R15 GET /coachip/results (S7) ───────────────────────────────────────── */
export type Tested = { n: number; floor: 5; window_id: string };

export type ResultCell = {
  school: School;
  grade: number;
  language: "ur" | "en";
  tested: Tested;
  rows: { w_id: string; short_name: Text; sentence: Text; count: Count | null; status: "ok" | "insufficient" | "not_measured" | "not_graded" }[];
  fln: { plan_ids: string[]; can_send: boolean };
  debrief_line: Text | null;
  i_id: string | null;
};

export type Results = { window: Window; windows: Window[]; cells: ResultCell[]; empty: Empty | null; computed_at: ISOTime };

/* ── R1 GET /coachip/me ──────────────────────────────────────────────────── */
export type Me = {
  coach: { schoolCount: number; teacherCount: number } | null;
  /** coachesHere (fix-r5 s5): this RM also coaches a school of the sector; absent from an older server. */
  rm: { sector: string; schoolCount: number; coachCount: number; coachesHere?: boolean } | null;
  decode: boolean;
  lang: "en" | "ur";
  computed_at: ISOTime;
};
