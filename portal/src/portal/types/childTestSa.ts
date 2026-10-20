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
  tasksDone: string[];
  lastSeq: number;
  audio: string[];
};
