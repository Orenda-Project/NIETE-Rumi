// bd-s1oo0.7 — the child test in the coach app. Mirrors what the bot returns
// (bot/shared/services/child-test/app/app-api.service.js); nothing here adds a default.

export type ChildTestBlockName = "urdu" | "english" | "maths";

export type ChildTestVisit = {
  visitId: string;
  startedAt: string;
  sealed: boolean;
  schoolId: string | null;
  schoolName: string | null;
  observedGrade: number | null;
};

export type ChildTestChild = {
  drawId: string;
  studentId: string;
  /** Never shown (L25): the bot no longer sends it; kept optional for lists drawn before. */
  rollNumber?: string | null;
  classId?: string;
  section?: string | null;
  /** The roster's class label, e.g. "Grade 3 - B", "Grade 3 - B (evening)", "Grade 3" (L25, CONTRACT §19). */
  classLabel?: string | null;
  classLabelUr?: string | null;
  /** "3-B" — the short form after the first mention. */
  classShort?: string | null;
  /** The room's class teacher (flagged, else the only reachable one); null → ask the head teacher. */
  teacherName?: string | null;
  teacherUserId?: string | null;
  fatherName?: string | null;
  /** Children in the class with this name (1 = unique); fatherTellsApart: the father's name separates them. */
  namesakes?: number;
  fatherTellsApart?: boolean;
  /** Shown to the coach only — never logged or sent anywhere else. */
  displayName: string;
  /** The roster's Urdu spelling, when it has one (CONTRACT v0.8 §13). */
  displayNameUrdu?: string | null;
  role: "new" | "returning";
  form: "A" | "B";
  status: "listed" | "tested" | "absent" | "refused" | "absent_final" | "pending";
  attempts?: number;
  sessionId?: string;
  sessionStatus?: string;
};

export type ChildTestList = {
  cycleId: string;
  grade: number;
  classId: string;
  children: ChildTestChild[];
  alternates: ChildTestChild[];
  gradeFallback?: boolean;
  reused?: boolean;
};

type CardBase = { block: ChildTestBlockName; grade: number; form: "A" | "B"; timedSeconds: number; cue: { start: string | null; stop: string | null } };

export type ReadingCard = CardBase & {
  block: "urdu" | "english";
  child: {
    story: { id: string; title: string | null; text: string };
    nonwords: { id: string; text: string }[];
    fallback: { letters: string[]; words: string[] } | null;
  };
  coach: { questions: { id: string; prompt: string }[]; firstSounds: { id: string; word: string }[] };
};

export type MathsCard = CardBase & {
  block: "maths";
  child: { numbers: number[]; quickSums: string[]; written: string[] };
  coach: {
    numbersStopRule: string | null;
    numberIds: string[];
    writtenIds: string[];
    wordProblem: { id: string; prompt_ur: string; prompt_en: string } | null;
  };
};

export type ChildTestCard = ReadingCard | MathsCard;

export type Verdict = "correct" | "wrong" | "none" | null;

// `unsure` (CHILD_TEST_PREFILL_MODE=assist): filled from the recording but below its confidence bar.
export type PrefillItem = { id: string; verdict: Verdict | string | null; heard?: string; confidence?: number; hint?: string | null; hint_only?: boolean; unsure?: boolean };

export type Prefill = {
  version: string | null;
  story?: {
    words_correct: number | null; words_attempted?: number; seconds?: number; finished_early?: boolean; confidence?: number; unsure?: boolean;
    flagged: { idx: number; word: string; verdict: string; confidence?: number }[];
    uncertain: { idx: number; word: string; verdict: string; confidence?: number }[];
  };
  fallback?: { letters: { correct: number | null; of: number }; words: { correct: number | null; of: number }; unsure?: boolean } | null;
  questions?: PrefillItem[];
  first_sounds?: PrefillItem[];
  nonwords?: PrefillItem[];
  maths?: {
    numbers: PrefillItem[];
    quick_sums?: { correct: number | null; attempted: number; seconds: number; unsure?: boolean };
    written: (PrefillItem & { read_answer?: string | null })[];
    word_problem?: (PrefillItem & { read_answer?: string | null }) | null;
  };
  protocol_flags?: string[];
};

export type ChildTestBlockStatus = {
  block: ChildTestBlockName;
  hasAudio: boolean;
  hasPhoto: boolean;
  aiStatus: "pending" | "scoring" | "scored" | "partial" | "failed" | null;
  aiReason: string | null;
  checked: boolean;
  prefill: Prefill | null;
};

export type ChildTestSession = {
  session: { id: string; status: string; grade: number; form: "A" | "B" };
  thresholdsSource: string | null;
  blocks: ChildTestBlockStatus[];
};
