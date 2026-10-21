// The coach's Learning assessment (child test, SA engine). Mirrors what the relay
// returns under /api/portal/leader/child-test/sa; nothing here adds a default.

export type SaSchool = {
  schoolId: string;
  name: string;
  visitId: string | null;
  observedGrade: number | null;
  visitToday: boolean;
};

export type SaOutcome = "present" | "absent" | "refused";

export type SaBlock = "B1" | "B2" | "B3" | "B4" | "B5" | "full";

/** The page's switches for this coach (GET …/sa/switches); each is off unless its row names them. */
export type SaSwitches = {
  handbackV2: boolean;
  micRequired: boolean;
  coachPicksBlock: boolean;
  rdfForm: boolean;
  resultsView: boolean;
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
