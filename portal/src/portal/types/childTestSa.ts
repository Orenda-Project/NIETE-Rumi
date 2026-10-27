// The coach's Learning assessment (child test, SA engine). Mirrors what the relay
// returns under /api/portal/leader/child-test/sa; nothing here adds a default.

export type SaSchool = {
  schoolId: string;
  name: string;
  visitId: string | null;
  observedGrade: number | null;
  visitToday: boolean;
  /** the school's EMIS and sector, for the search box and the row's second line (null when the school has none) */
  emis?: string | null;
  region?: string | null;
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
  /** sa_add_child: the coach can add a child who is not on the roster to the open list */
  addChild?: boolean;
  /** sa_ur_fit: every Urdu word whole and inside its box on these pages (lib/assess/urFit.ts) */
  urFit?: boolean;
  /** sa_example_dashboard: the example results dashboard (synthetic students); the server reports it on sandbox only */
  exampleDashboard?: boolean;
  /** sa_real_dashboard: the same dashboard on this tier's real sessions (the coach's own; a results admin's every coach's) */
  realDashboard?: boolean;
  /** sa_review_page: the visit review, one session item by item with a reviewer's mark per item */
  reviewPage?: boolean;
  /** sa_end_test_restart: the corner End test works; an ended child stays on the list with Restart test */
  endTestRestart?: boolean;
  /** sa_end_section: coach-led (RDF manual) End this section skips to the next section */
  endSection?: boolean;
  /** sa_dash_filters: the dashboard's mode / date / coach filters and every skip and stop by type and coach */
  dashFilters?: boolean;
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
  /** sa_stop_rules: why a reading task stopped early by rule ('first_row' | 'first_line') */
  stopWhy?: string | null;
  recording: "none" | "scored_later" | "scored";
  score: Record<string, number> | null;
  /** the scorer heard another person (an adult, another child) in the recording: the score may include their help */
  secondVoice?: boolean;
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

/** One session on the results dashboard (GET …/sa/sessions, switch sa_real_dashboard): its school, sub-region and results. No names. */
export type SaDashboardSession = {
  schoolId: string | null;
  schoolName: string | null;
  /** schools.region; null when the school has none */
  sector: string | null;
  grade: number;
  results: SaResults;
};

/** A mark of one scoring agent (or their consensus): correct, wrong, no response, silent. */
export type SaAgentMark = "c" | "w" | "n" | "s" | null;
export type SaEarMark = "correct" | "wrong" | "unclear";

/** One spoken item on the visit review. Never what the child said. */
export type SaReviewItem = {
  key: string;
  /** what the phone showed (a letter, a word) or the question's id */
  ref: string | null;
  app: { verdict: string | null; conf: number | null; noSpeech: boolean; secondVoice?: boolean };
  agents: {
    consensus: SaAgentMark; flash: SaAgentMark; pro: SaAgentMark; stt: SaAgentMark;
    confidence: number | null; noSpeech: boolean; disputed: boolean; lowTrust: boolean;
  } | null;
  /** an app "correct" on a clip with no speech, or an answer under 1 s */
  suspect: boolean;
  ear: { mark: SaEarMark | null; note: string | null; at: string | null; mine: boolean } | null;
  /** the app's mark judged by the ear */
  appRight: "right" | "wrong" | "unclear" | null;
};

export type SaReviewTask = {
  taskId: string;
  mode: SaResponseMode | null;
  timeUsedS: number | null;
  app: { correct: number | null; attempted: number | null; of: number | null; perMinute: number | null };
  scoredAt: string | null;
  scoredAfterFix: boolean | null;
  /** 1-hour links to the task's recordings */
  clips: { label: string; url: string }[];
  items: SaReviewItem[];
  /** the scorer heard another person in this task's recording */
  secondVoice?: boolean;
  agreement: { reviewed: number; earAgreesWithApp: number; agentsAgreeWithApp: number; withAgents: number };
};

/** GET …/sa/session/:id/review (switch sa_review_page). No names. */
export type SaReview = {
  session: { id: string; grade: number; block: string | null; status: string; startedAt: string | null; endedAt: string | null; minutes: number | null };
  fixAt: string | null;
  tasks: SaReviewTask[];
};
