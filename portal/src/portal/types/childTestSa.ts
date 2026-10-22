// The coach's Learning assessment (child test, SA engine). Mirrors what the relay
// returns under /api/portal/leader/child-test/sa; nothing here adds a default.

export type SaSchool = {
  schoolId: string;
  name: string;
  visitId: string | null;
  observedGrade: number | null;
  visitToday: boolean;
  /** sa_all_grades: the grade the coach named for this school's list (1–5); absent = today's grade rotation */
  grade?: number;
};

export type SaOutcome = "present" | "absent" | "refused";

export type SaBlock = "B1" | "B2" | "B3" | "B4" | "B5" | "full" | "rdf" | "rdf_auto" | "rdf_manual";

/** The page's switches for this coach (GET …/sa/switches); each is off unless its row names them. */
export type SaSwitches = {
  handbackV2: boolean;
  micRequired: boolean;
  coachPicksBlock: boolean;
  rdfForm: boolean;
  resultsView: boolean;
  /** sa_rdf_w3_forms: the RDF entry is two, RDF auto and RDF manual */
  rdfW3Forms?: boolean;
  /** A child the engine refused (its voice was not ready) is not Stopped: the row stays open (RULING #51). */
  voiceGateV2: boolean;
  /** sa_resume_repick: a resumed child's part can be chosen again on the card; the visit clock skips earlier sittings */
  resumeRepick?: boolean;
  /** sa_all_grades: the coach names Grade 1–5 after the school */
  allGrades?: boolean;
  /** sa_example_dashboard: the example results dashboard (synthetic students); the server reports it on sandbox only */
  exampleDashboard?: boolean;
};

/** One drawn child. Never a roll number or student id (operator: "Name · Grade 3 - A · Teacher: …"). */
export type SaChild = {
  drawId: string;
  name: string;
  nameUr: string | null;
  firstName: string;
  firstNameUr: string | null;
  grade: number;
  section: string | null;
  classLabel: string | null;
  classLabelUr: string | null;
  teacherName: string | null;
  status: "listed" | "tested" | "absent" | "refused" | "absent_final" | "pending";
  childNo: number;
  role: "new" | "returning";
  namesake: boolean;
  sessionId?: string;
  sessionStatus?: string;
  /** the block the server holds for the child's session, and when it started */
  sessionBlock?: SaBlock;
  sessionStartedAt?: string;
};

export type SaList = {
  visit: { visitId: string | null; visitKey: string | null };
  cycleId: string;
  grade: number;
  gradeFallback: boolean;
  reused: boolean;
  children: SaChild[];
  alternates: SaChild[];
};

export type SaSessionStatus = {
  session: { id: string; status: string; grade: number; form: string };
  block?: SaBlock;
  tasksDone: string[];
  lastSeq: number;
  audio: string[];
  /** spoken subtasks whose answers arrived but whose recording is still on the phone */
  audioWaiting?: string[];
};

/** How the child answered a task (child_test_blocks.response_mode). */
export type SaResponseMode = "tap" | "keypad" | "keyboard" | "record" | "oral";

/**
 * One task of a session's results: the SA scale for tap / keypad (never EGRA's clpm / cwpm), and for a spoken
 * task whether the recording is kept and scored later or already scored (`score`: that scorer's numbers).
 */
export type SaTaskResult = {
  taskId: string;
  /** the battery's own name for the task; absent for a task the battery no longer has */
  title?: { en: string | null; ur: string | null } | null;
  mode: SaResponseMode | null;
  attempted: number | null;
  correct: number | null;
  optionsN: number | null;
  chanceCorrected: number | null;
  itemsPerMin: number | null;
  stopReason: string | null;
  recording: "none" | "scored_later" | "scored";
  score: Record<string, number> | null;
};

/** GET …/sa/session/:id/results (switch sa_results_view; 404 when off or not this coach's session). No names. */
export type SaResults = {
  session: {
    id: string;
    grade: number;
    form: string;
    /** B1–B5, full, rdf — or a block this page does not know yet */
    block: SaBlock | "rdf" | (string & {}) | null;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    lang: "ur" | "en" | null;
  };
  tasks: SaTaskResult[];
};
