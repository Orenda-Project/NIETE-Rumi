/**
 * Every word of the coach's School card screens (the slim Coach Home, a school's card, a feature by teacher, a teacher,
 * her lists, her Coaching page and a DC report), in English and Urdu. Read with `useCopy(SCHOOL_CARD)`; `ur` is typed
 * to `en`'s exact shape, so a missing key fails the build. Names, titles, numbers and the report texts are DATA and are
 * not here.
 *
 * Words follow the ontology (ict-niete-ontology.md): DC observation ڈیجیٹل کوچنگ مشاہدہ, Coach observations مشاہدات,
 * Lesson plan لیسن پلان, Assessment (the feature; the item is a Paper) پرچہ, Assessments پرچے (never "Papers made"), Part حصہ, Course کورس, Report رپورٹ, Principal ہیڈ ٹیچر,
 * Digital Coaching ڈیجیٹل کوچنگ (never "Coaching" alone), Coach observations کوچ کے مشاہدات (an observation, never a visit),
 * Lesson (the class she taught) سبق,
 * scores say whose they are ("AI score" / "Coach score"), never HITL.
 *
 * URDU: MACHINE-DRAFTED. Every Urdu value here waits for a native check (verdict NATIVE-CHECK), like the coach area's other
 * copy modules. Bars and grids stay left to right in Urdu; only their labels are Urdu.
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";
import type { CopyEntry } from "../../teacher/copyRegistry";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const SCHOOL_CARD_EN = {
  dash: "—",
  period: "Period",
  periods: { today: "Today", week: "This week", month: "This month" },
  /** "Nothing this week", the neutral fold for teachers with nothing in the period. */
  nothing: { today: "Nothing today", week: "Nothing this week", month: "Nothing this month" },

  // Days and weeks under the bars and above the grid columns
  weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  wk: (i: number) => `Wk ${i}`,
  dayMonth: (d: number, monthName: string) => `${d} ${monthName}`,
  weekdayDayMonth: (weekday: string, d: number, monthName: string) => `${weekday} ${d} ${monthName}`,
  today: "Today",
  yesterday: "Yesterday",
  listJoin: ", ",
  and: (a: string, b: string) => `${a} and ${b}`,
  oneAhead: (day: string) => `${day} is still ahead`,
  manyAhead: (days: string) => `${days} are still ahead`,

  // The slim Coach Home
  coursesN: (n: number) => `${n} ${plural(n, "course", "courses")}`,
  schoolsTeachers: (s: number, t: number) => `${s} ${plural(s, "school", "schools")} · ${t} ${plural(t, "teacher", "teachers")}`,

  // A school's card
  emis: (code: string) => `EMIS ${code}`,
  lastVisit: (d: number | null) => (d == null ? "No visits yet" : d === 0 ? "Last visit · today" : d === 1 ? "Last visit · 1 day ago" : `Last visit · ${d} days ago`),
  activity: "Activity",
  /** The tile's word after its big number: "27 lesson plans". */
  tileLabel: {
    lp: (n: number) => plural(n, "lesson plan", "lesson plans"),
    dc: (n: number) => plural(n, "DC observation", "DC observations"),
    training: (n: number) => plural(n, "training part", "training parts"),
    papers: (n: number) => plural(n, "assessment", "assessments"),
  },
  byN: (a: number, b: number) => `by ${a} of ${b} teachers`,
  aboutDay: (n: number) => `about ${n} a day`,
  lessThanOneDay: "less than 1 a day",
  teachers: "Teachers",
  contribution: "Contribution",
  topContributor: "Top contributor",
  teacherName: "Teacher name",
  noTeachers: "No teachers yet",
  noMatch: "No teacher by that name",
  coachObs: "Coach observations",
  obsN: (n: number) => `${n} ${plural(n, "observation", "observations")}`,
  coachScore: "Coach score",
  aiScore: "AI score",
  same: "Same",
  /** What a screen reader hears for a teacher's four small counts. */
  countsSpoken: (lp: number, dc: number, training: number, papers: number) =>
    `Lesson plans ${lp}, DC observations ${dc}, training parts ${training}, assessments ${papers}`,

  // A feature by teacher
  byTeacher: { lp: "Lesson plans by teacher", dc: "Digital Coaching by teacher", coach: "Coach observations by teacher", training: "Training parts by teacher", papers: "Assessments by teacher" },
  schoolRow: "School",
  total: "Total",

  // A teacher
  tiles: { lp: "Lesson plans", papers: "Assessments", training: "Training parts" },
  coursesDone: (n: number) => `${n} ${plural(n, "course", "courses")} done`,
  noScores: "No scores yet",
  onlyYou: "Only you see this",
  pct: (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`),

  // Digital Coaching and Coach observations: a tile each (School card, Teacher page), her page of each, by teacher
  digitalCoaching: "Digital Coaching",
  coachObsName: "Coach observations",
  avgOf: { dc: "average AI score", coach: "average Coach score" },
  /** "days used" with "4/4" (the days she used NIETE out of the school days so far). */
  daysUsed: "days used",
  /** One letter under each school day's dot (Sun..Sat). */
  dayInitials: ["S", "M", "T", "W", "T", "F", "S"],
  teacherCol: "Teacher",
  scoresCol: "Scores",
  averageCol: "Average",
  tapDot: "Tap a dot to open its report",
  avgLine: (n: number) => `Avg ${n}%`,
  byPractice: "Average by practice",
  across: {
    dc: (n: number, max: number) => `Across her ${n} ${plural(n, "report", "reports")} · out of ${max}`,
    coach: (n: number, max: number) => `Across her ${n} ${plural(n, "observation", "observations")} · out of ${max}`,
  },
  scoredIn: (k: number, n: number) => `Scored in ${k} of ${n} (the others had no lesson plan)`,
  noLpLinked: "No lesson plan linked, so this section was not scored",
  herList: { dc: "Her reports", coach: "Her observations" },
  noKind: {
    dc: { today: "No DC observations today", week: "No DC observations this week", month: "No DC observations this month" },
    coach: { today: "No coach observations today", week: "No coach observations this week", month: "No coach observations this month" },
  },
  /** "1.5/2": a practice's average out of the framework's scale. */
  outOf: (v: number, max: number) => `${v}/${max}`,
  /** A report's title when it has no topic and no real lesson label: the kit's short subject ("Math lesson"). */
  lessonOf: (subject: string) => (subject ? `${subject} lesson` : "Lesson"),

  // Her lists
  allOf: { lp: "All Lesson Plans", papers: "All Assessments", training: "Training" },
  aiScoreN: (n: number) => `AI score ${n}%`,
  coachScoreN: (n: number) => `Coach score ${n}%`,
  fieldForm: "Field form",
  questionsMarks: (q: number, m: number) => `${q} questions · ${m} marks`,
  questionsN: (q: number) => `${q} questions`,
  partsDone: (a: number, b: number) => `${a} of ${b} parts done`,
  done: "Done",
  notDone: "Not done",

  // A report
  wentWell: "What went well",
  notScored: "Not scored",
  stepAgreed: "Step agreed",
  /** The four framework sections, as the framework names them (its displayName). */
  sectionNames: { B: "Lesson Plan Fidelity", C: "High-Leverage Practices", D: "Student Engagement", F: "Teacher Subject Knowledge" },
  sectionKey: (code: string, name: string) => `${code} · ${name}`,

  // A DC report, the coach's view
  report: "Report",
  coachView: "Coach view",
  nextStep: "Next step",
  sections: "Sections",
  everyPractice: "Every practice",
  notScoredList: (codes: string) => `Not scored: ${codes}`,
  scoreOf: (s: number, max: number) => `${s}/${max}`,
  lpSteps: "Lesson plan steps",
  stepsDone: (a: number, b: number) => `${a} of ${b} steps`,
  stepDone: "Done",
  stepSkipped: "Skipped",
  stepPartly: "Partly",
  /** The report card's five lesson steps (bot report-card.js STEPS), in order: Lesson Plan Fidelity's rows (bd-dgfkgs.3). */
  stepNames: ["Opening", "Explanation", "We Do", "You Do", "Check"],
  noPlan: "No lesson plan linked",
  reflection: "Her reflection",
  gradeSubject: (grade: string, subject: string) => `${grade} · ${subject}`,
};

export type SchoolCardCopy = Words<typeof SCHOOL_CARD_EN>;

export const SCHOOL_CARD_UR: SchoolCardCopy = {
  dash: "—",
  period: "مدت",
  periods: { today: "آج", week: "یہ ہفتہ", month: "یہ مہینہ" },
  nothing: { today: "آج کچھ نہیں", week: "اس ہفتے کچھ نہیں", month: "اس مہینے کچھ نہیں" },

  weekdays: ["اتوار", "پیر", "منگل", "بدھ", "جمعرات", "جمعہ", "ہفتہ"],
  months: ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"],
  wk: (i) => `ہفتہ ${i}`,
  dayMonth: (d, monthName) => `${d} ${monthName}`,
  weekdayDayMonth: (weekday, d, monthName) => `${weekday}، ${d} ${monthName}`,
  today: "آج",
  yesterday: "کل",
  listJoin: "، ",
  and: (a, b) => `${a} اور ${b}`,
  oneAhead: (day) => `${day} ابھی باقی ہے`,
  manyAhead: (days) => `${days} ابھی باقی ہیں`,

  coursesN: (n) => `${n} کورسز`,
  schoolsTeachers: (s, t) => `${s} اسکول · ${t} ٹیچرز`,

  emis: (code) => `EMIS ${code}`,
  lastVisit: (d) => (d == null ? "ابھی کوئی دورہ نہیں" : d === 0 ? "آخری دورہ · آج" : `آخری دورہ · ${d} دن پہلے`),
  activity: "سرگرمی",
  tileLabel: {
    lp: () => "لیسن پلان",
    dc: () => "ڈیجیٹل کوچنگ مشاہدات",
    training: () => "ٹریننگ کے حصے",
    papers: () => "پرچے",
  },
  byN: (a, b) => `${b} میں سے ${a} ٹیچرز نے`,
  aboutDay: (n) => `روزانہ تقریباً ${n}`,
  lessThanOneDay: "روزانہ 1 سے کم",
  teachers: "ٹیچرز",
  contribution: "حصہ",
  topContributor: "سب سے زیادہ حصہ",
  teacherName: "ٹیچر کا نام",
  noTeachers: "ابھی کوئی ٹیچر نہیں",
  noMatch: "اس نام کی کوئی ٹیچر نہیں",
  coachObs: "مشاہدات",
  obsN: (n) => (n === 1 ? "1 مشاہدہ" : `${n} مشاہدات`),
  coachScore: "کوچ اسکور",
  aiScore: "اے آئی اسکور",
  same: "برابر",
  countsSpoken: (lp, dc, training, papers) => `لیسن پلان ${lp}، ڈیجیٹل کوچنگ مشاہدات ${dc}، ٹریننگ کے حصے ${training}، پرچے ${papers}`,

  byTeacher: { lp: "ٹیچر کے حساب سے لیسن پلان", dc: "ٹیچر کے حساب سے ڈیجیٹل کوچنگ", coach: "ٹیچر کے حساب سے کوچ کے مشاہدات", training: "ٹیچر کے حساب سے ٹریننگ کے حصے", papers: "ٹیچر کے حساب سے پرچے" },
  schoolRow: "اسکول",
  total: "کل",

  tiles: { lp: "لیسن پلان", papers: "پرچے", training: "ٹریننگ کے حصے" },
  coursesDone: (n) => `${n} کورس مکمل`,
  noScores: "ابھی کوئی اسکور نہیں",
  onlyYou: "صرف آپ کے لیے",
  pct: (n) => (n == null ? "—" : `${Math.round(n)}%`),

  digitalCoaching: "ڈیجیٹل کوچنگ",
  coachObsName: "کوچ کے مشاہدات",
  avgOf: { dc: "اوسط اے آئی اسکور", coach: "اوسط کوچ اسکور" },
  daysUsed: "استعمال کے دن",
  dayInitials: ["ا", "پ", "م", "ب", "ج", "ج", "ہ"],
  teacherCol: "ٹیچر",
  scoresCol: "اسکور",
  averageCol: "اوسط",
  tapDot: "رپورٹ کھولنے کے لیے نقطے پر ٹیپ کریں",
  avgLine: (n) => `اوسط ${n}%`,
  byPractice: "ہر طریقے کا اوسط",
  across: {
    dc: (n, max) => `ان کی ${n} رپورٹس میں · ${max} میں سے`,
    coach: (n, max) => `ان کے ${n} مشاہدات میں · ${max} میں سے`,
  },
  scoredIn: (k, n) => `${n} میں سے ${k} میں اسکور ہوا (باقی میں لیسن پلان نہیں تھا)`,
  noLpLinked: "کوئی لیسن پلان نہیں جڑا، اس لیے یہ حصہ اسکور نہیں ہوا",
  herList: { dc: "ان کی رپورٹس", coach: "ان کے مشاہدات" },
  noKind: {
    dc: { today: "آج کوئی ڈیجیٹل کوچنگ مشاہدہ نہیں", week: "اس ہفتے کوئی ڈیجیٹل کوچنگ مشاہدہ نہیں", month: "اس مہینے کوئی ڈیجیٹل کوچنگ مشاہدہ نہیں" },
    coach: { today: "آج کوچ کا کوئی مشاہدہ نہیں", week: "اس ہفتے کوچ کا کوئی مشاہدہ نہیں", month: "اس مہینے کوچ کا کوئی مشاہدہ نہیں" },
  },
  outOf: (v, max) => `${v}/${max}`,
  lessonOf: (subject) => (subject ? `${subject} کا سبق` : "سبق"),

  allOf: { lp: "تمام لیسن پلان", papers: "تمام پرچے", training: "ٹریننگ" },
  aiScoreN: (n) => `اے آئی اسکور ${n}%`,
  coachScoreN: (n) => `کوچ اسکور ${n}%`,
  fieldForm: "فیلڈ فارم",
  questionsMarks: (q, m) => `${q} سوالات · ${m} نمبر`,
  questionsN: (q) => `${q} سوالات`,
  partsDone: (a, b) => `${b} میں سے ${a} حصے مکمل`,
  done: "مکمل",
  notDone: "مکمل نہیں",

  wentWell: "کیا اچھا رہا",
  notScored: "اسکور نہیں ہوا",
  stepAgreed: "طے شدہ قدم",
  sectionNames: { B: "سبق کے منصوبے پر عمل درآمد", C: "مؤثر تدریسی طریقے", D: "طلبہ کی شمولیت", F: "استاد کا مضمون سے متعلق علم" },
  sectionKey: (code, name) => `${code} · ${name}`,

  report: "رپورٹ",
  coachView: "کوچ کا منظر",
  nextStep: "اگلا قدم",
  sections: "حصے",
  everyPractice: "ہر طریقہ",
  notScoredList: (codes) => `اسکور نہیں ہوا: ${codes}`,
  scoreOf: (s, max) => `${s}/${max}`,
  lpSteps: "لیسن پلان کے مراحل",
  stepsDone: (a, b) => `${b} میں سے ${a} مراحل`,
  stepDone: "مکمل",
  stepSkipped: "چھوڑ دیا",
  stepPartly: "جزوی",
  // Machine-drafted (bd-dgfkgs.3, 30 Oct): no Urdu for the five steps existed anywhere; on the Urdu review list.
  stepNames: ["آغاز", "وضاحت", "ہم کریں", "آپ کریں", "جانچ"],
  noPlan: "کوئی لیسن پلان نہیں جڑا",
  reflection: "ان کا غور و فکر",
  gradeSubject: (grade, subject) => `${grade} · ${subject}`,
};

export const SCHOOL_CARD: Bilingual<typeof SCHOOL_CARD_EN> = bilingual(SCHOOL_CARD_EN, SCHOOL_CARD_UR);

export const COPY_ENTRY: CopyEntry = {
  screen: "coach · school card",
  module: SCHOOL_CARD as Bilingual<unknown>,
  // "—" is a dash; the joins and the framework-code pairs print only what they are given; a day under a bar is a number.
  same: ["dash", "dayMonth", "sectionKey", "gradeSubject", "emis", "pct", "scoreOf", "outOf"],
  // Lines that are a whole phrase by design: "by 8 of 14 teachers", "Thu and Fri are still ahead", the screen-reader
  // reading of the four counts, the report headings as drawn, and the empty lines that name the period.
  longOk: ["noKind", "across", "scoredIn", "noLpLinked", "tapDot", "sectionNames", "reflection", "byN", "oneAhead", "manyAhead", "countsSpoken", "noMatch", "byTeacher", "allOf", "schoolsTeachers", "partsDone", "questionsMarks", "lastVisit", "noPlan", "lessThanOneDay", "notScoredList", "stepsDone", "weekdayDayMonth"],
};
