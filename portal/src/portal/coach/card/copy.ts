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
  /** bd-17v39c.4.15 — the school's principal, apart from its teachers: the header chip "Principal: name ›", the chip when
   *  none is recorded ("Principal: not recorded ›", opens Edit teacher), and what a screen reader hears for each. */
  principalKey: "Principal:",
  principalNone: "not recorded",
  principalSpoken: (name: string) => `Principal, ${name}. Open their page`,
  principalNoneSpoken: "Principal not recorded. Open Edit teacher",
  activity: "Activity",
  /** The tile's word after its big number: "27 lesson plans". */
  tileLabel: {
    lp: (n: number) => plural(n, "lesson plan", "lesson plans"),
    dc: (n: number) => plural(n, "DC observation", "DC observations"),
    // bd-17v39c.4.13 (operator, 5 Nov): training counts one way, modules completed (one row per teacher and module).
    training: (n: number) => plural(n, "module completed", "modules completed"),
    papers: (n: number) => plural(n, "assessment", "assessments"),
  },
  byN: (a: number, b: number) => `by ${a} of ${b} teachers`,
  aboutDay: (n: number) => `about ${n} a day`,
  lessThanOneDay: "less than 1 a day",
  teachers: "Teachers",
  contribution: "Contribution",
  /** The table's head: a soft hyphen lets it break in two on a 360 px phone. */
  contributionHead: "Contri\u00ADbution",
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
    `Lesson plans ${lp}, DC observations ${dc}, modules completed ${training}, assessments ${papers}`,

  // bd-17v39c.4.13 — Rifat's School view: the overview, the teacher table, the coach-observations table
  /** "7 of 12" (teachers), big. */
  nOfM: (a: number, b: number) => `${a} of ${b}`,
  usedNiete: { today: "teachers used NIETE today", week: "teachers used NIETE this week", month: "teachers used NIETE this month" },
  usedBefore: {
    today: (a: number, b: number) => `Yesterday: ${a} of ${b}`,
    week: (a: number, b: number) => `Last week: ${a} of ${b}`,
    month: (a: number, b: number) => `Last month: ${a} of ${b}`,
  },
  acrossTap: {
    today: (n: number) => `Today, across ${n} teachers · tap a box for details`,
    week: (n: number) => `This week, across ${n} teachers · tap a box for details`,
    month: (n: number) => `This month, across ${n} teachers · tap a box for details`,
  },
  noUseYet: { today: "No NIETE use recorded today yet.", week: "No NIETE use recorded this week yet.", month: "No NIETE use recorded this month yet." },
  boxTraining: "Training",
  /** Lesson plans per teacher per school day, one decimal (operator, 5 Nov: option A). */
  perTeacherDay: {
    today: (v: string) => `${v} per teacher today`,
    week: (v: string) => `${v} a school day per teacher`,
    month: (v: string) => `${v} a school day per teacher`,
  },
  /** The same days of the period before. */
  rateBefore: {
    today: (v: string) => `yesterday ${v}`,
    week: (v: string) => `last week ${v}, same days`,
    month: (v: string) => `last month ${v}, same days`,
  },
  /** The details page's line: a capital, it stands alone. */
  rateBeforeLine: {
    today: (v: string) => `Yesterday ${v}`,
    week: (v: string) => `Last week ${v}, same days`,
    month: (v: string) => `Last month ${v}, same days`,
  },
  pctBefore: { today: (p: string) => `yesterday ${p}`, week: (p: string) => `last week ${p}`, month: (p: string) => `last month ${p}` },
  average: "average",
  coachAverage: "Coach average",
  tapTeacher: "Tap a teacher to see their details",
  /** A table head's icon, said to a screen reader. */
  featureName: { lp: "Lesson plans", dc: "DC observations", training: "Modules completed", papers: "Assessments" },
  showAll: (n: number) => `Show all ${n} teachers`,
  obsSub: (obs: string, avg: string) => `${obs} · average ${avg}`,
  lastWeekPct: { today: (p: string) => `(yesterday ${p})`, week: (p: string) => `(last week ${p})`, month: (p: string) => `(last month ${p})` },
  obsCol: "Obs",
  trendCol: "Trend",
  changeCol: "Change",
  latestCol: "Latest",
  /** A teacher's only scored observation of the period: no change to show yet. */
  first: "first",
  byTeacherHead: "By teacher",
  mostFirst: {
    lp: "Most first · tap a teacher for her lesson plans",
    papers: "Most first · tap a teacher for her assessments",
    training: "Most first · tap a teacher for her training",
  },
  noneYet: {
    lp: { today: "No lesson plans today yet", week: "No lesson plans this week yet", month: "No lesson plans this month yet" },
    papers: { today: "No assessments today yet", week: "No assessments this week yet", month: "No assessments this month yet" },
    training: { today: "No modules completed today yet", week: "No modules completed this week yet", month: "No modules completed this month yet" },
  },
  /** Training by teacher: her modules over her trainings, and this period's. */
  modulesOf: (a: number, b: number) => `${a} of ${b} modules completed`,
  inPeriodN: { today: (n: number) => `${n} today`, week: (n: number) => `${n} this week`, month: (n: number) => `${n} this month` },
  /** A training's modules: "130/171". */
  doneOf: (a: number, b: number) => `${a}/${b}`,

  // A feature by teacher
  byTeacher: { lp: "Lesson plans by teacher", dc: "Digital Coaching by teacher", coach: "Coach observations by teacher", training: "Training by teacher", papers: "Assessments by teacher" },
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
  /** Her days page's title (bd-dgfkgs.4). */
  daysTitle: "Days used",
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
  done: "Done",
  // bd-hl4a4y — Training: a teacher with no training programme (her page, and her row on Training by teacher).
  noTraining: "No training yet",

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
  // bd-17v39c.4.15 — machine-drafted, NATIVE-CHECK (Principal ہیڈ ٹیچر per the ontology; Edit teacher as people/copy.ts).
  principalKey: "ہیڈ ٹیچر:",
  principalNone: "درج نہیں",
  principalSpoken: (name) => `ہیڈ ٹیچر، ${name}۔ ان کا صفحہ کھولیں`,
  principalNoneSpoken: "ہیڈ ٹیچر درج نہیں۔ ٹیچر میں ترمیم کھولیں",
  activity: "سرگرمی",
  tileLabel: {
    lp: () => "لیسن پلان",
    dc: () => "ڈیجیٹل کوچنگ مشاہدات",
    training: () => "ماڈیول مکمل",
    papers: () => "پرچے",
  },
  byN: (a, b) => `${b} میں سے ${a} ٹیچرز نے`,
  aboutDay: (n) => `روزانہ تقریباً ${n}`,
  lessThanOneDay: "روزانہ 1 سے کم",
  teachers: "ٹیچرز",
  contribution: "حصہ",
  contributionHead: "حصہ",
  topContributor: "سب سے زیادہ حصہ",
  teacherName: "ٹیچر کا نام",
  noTeachers: "ابھی کوئی ٹیچر نہیں",
  noMatch: "اس نام کی کوئی ٹیچر نہیں",
  coachObs: "مشاہدات",
  obsN: (n) => (n === 1 ? "1 مشاہدہ" : `${n} مشاہدات`),
  coachScore: "کوچ اسکور",
  aiScore: "اے آئی اسکور",
  same: "برابر",
  countsSpoken: (lp, dc, training, papers) => `لیسن پلان ${lp}، ڈیجیٹل کوچنگ مشاہدات ${dc}، ماڈیول مکمل ${training}، پرچے ${papers}`,

  nOfM: (a, b) => `${b} میں سے ${a}`,
  usedNiete: { today: "ٹیچرز نے آج NIETE استعمال کیا", week: "ٹیچرز نے اس ہفتے NIETE استعمال کیا", month: "ٹیچرز نے اس مہینے NIETE استعمال کیا" },
  usedBefore: {
    today: (a, b) => `کل: ${b} میں سے ${a}`,
    week: (a, b) => `پچھلا ہفتہ: ${b} میں سے ${a}`,
    month: (a, b) => `پچھلا مہینہ: ${b} میں سے ${a}`,
  },
  acrossTap: {
    today: (n) => `آج، ${n} ٹیچرز · تفصیل کے لیے ٹیپ کریں`,
    week: (n) => `اس ہفتے، ${n} ٹیچرز · تفصیل کے لیے ٹیپ کریں`,
    month: (n) => `اس مہینے، ${n} ٹیچرز · تفصیل کے لیے ٹیپ کریں`,
  },
  noUseYet: { today: "آج ابھی NIETE کا کوئی استعمال درج نہیں۔", week: "اس ہفتے ابھی NIETE کا کوئی استعمال درج نہیں۔", month: "اس مہینے ابھی NIETE کا کوئی استعمال درج نہیں۔" },
  boxTraining: "ٹریننگ",
  perTeacherDay: {
    today: (v) => `آج فی ٹیچر \u2066${v}\u2069`,
    week: (v) => `ہر اسکول دن فی ٹیچر \u2066${v}\u2069`,
    month: (v) => `ہر اسکول دن فی ٹیچر \u2066${v}\u2069`,
  },
  rateBefore: {
    today: (v) => `کل \u2066${v}\u2069`,
    week: (v) => `پچھلا ہفتہ \u2066${v}\u2069، انہی دنوں`,
    month: (v) => `پچھلا مہینہ \u2066${v}\u2069، انہی دنوں`,
  },
  rateBeforeLine: {
    today: (v) => `کل \u2066${v}\u2069`,
    week: (v) => `پچھلا ہفتہ \u2066${v}\u2069، انہی دنوں`,
    month: (v) => `پچھلا مہینہ \u2066${v}\u2069، انہی دنوں`,
  },
  pctBefore: { today: (p) => `کل \u2066${p}\u2069`, week: (p) => `پچھلا ہفتہ \u2066${p}\u2069`, month: (p) => `پچھلا مہینہ \u2066${p}\u2069` },
  average: "اوسط",
  coachAverage: "کوچ کی اوسط",
  tapTeacher: "تفصیل کے لیے ٹیچر پر ٹیپ کریں",
  featureName: { lp: "لیسن پلان", dc: "ڈیجیٹل کوچنگ مشاہدات", training: "ماڈیول مکمل", papers: "پرچے" },
  showAll: (n) => `تمام ${n} ٹیچرز دکھائیں`,
  obsSub: (obs, avg) => `${obs} · اوسط \u2066${avg}\u2069`,
  lastWeekPct: { today: (p) => `(کل \u2066${p}\u2069)`, week: (p) => `(پچھلا ہفتہ \u2066${p}\u2069)`, month: (p) => `(پچھلا مہینہ \u2066${p}\u2069)` },
  obsCol: "مشاہدات",
  trendCol: "رجحان",
  changeCol: "تبدیلی",
  latestCol: "تازہ ترین",
  first: "پہلا",
  byTeacherHead: "ٹیچر کے حساب سے",
  mostFirst: {
    lp: "سب سے زیادہ پہلے · ان کے لیسن پلان کے لیے ٹیچر پر ٹیپ کریں",
    papers: "سب سے زیادہ پہلے · ان کے پرچوں کے لیے ٹیچر پر ٹیپ کریں",
    training: "سب سے زیادہ پہلے · ان کی ٹریننگ کے لیے ٹیچر پر ٹیپ کریں",
  },
  noneYet: {
    lp: { today: "آج ابھی کوئی لیسن پلان نہیں", week: "اس ہفتے ابھی کوئی لیسن پلان نہیں", month: "اس مہینے ابھی کوئی لیسن پلان نہیں" },
    papers: { today: "آج ابھی کوئی پرچہ نہیں", week: "اس ہفتے ابھی کوئی پرچہ نہیں", month: "اس مہینے ابھی کوئی پرچہ نہیں" },
    training: { today: "آج ابھی کوئی ماڈیول مکمل نہیں", week: "اس ہفتے ابھی کوئی ماڈیول مکمل نہیں", month: "اس مہینے ابھی کوئی ماڈیول مکمل نہیں" },
  },
  modulesOf: (a, b) => `${b} میں سے ${a} ماڈیول مکمل`,
  inPeriodN: { today: (n) => `آج ${n}`, week: (n) => `اس ہفتے ${n}`, month: (n) => `اس مہینے ${n}` },
  doneOf: (a, b) => `${a}/${b}`,

  byTeacher: { lp: "ٹیچر کے حساب سے لیسن پلان", dc: "ٹیچر کے حساب سے ڈیجیٹل کوچنگ", coach: "ٹیچر کے حساب سے کوچ کے مشاہدات", training: "ٹیچر کے حساب سے ٹریننگ", papers: "ٹیچر کے حساب سے پرچے" },
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
  daysTitle: "استعمال کے دن",
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
  done: "مکمل",
  noTraining: "ابھی کوئی ٹریننگ نہیں",

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
  same: ["dash", "dayMonth", "sectionKey", "gradeSubject", "emis", "pct", "scoreOf", "outOf", "doneOf"],
  // Lines that are a whole phrase by design: "by 8 of 14 teachers", "Thu and Fri are still ahead", the screen-reader
  // reading of the four counts, the report headings as drawn, and the empty lines that name the period.
  longOk: ["noKind", "across", "scoredIn", "noLpLinked", "tapDot", "sectionNames", "reflection", "byN", "oneAhead", "manyAhead", "countsSpoken", "noMatch", "byTeacher", "allOf", "schoolsTeachers", "questionsMarks", "lastVisit", "noPlan", "lessThanOneDay", "notScoredList", "stepsDone", "weekdayDayMonth",
    // bd-17v39c.4.13 — the School view's lines, each a whole phrase as drawn in mockups v3
    "usedNiete", "usedBefore", "acrossTap", "noUseYet", "perTeacherDay", "rateBefore", "rateBeforeLine", "pctBefore", "tapTeacher",
    "showAll", "obsSub", "lastWeekPct", "mostFirst", "noneYet", "modulesOf", "inPeriodN", "featureName",
    // bd-17v39c.4.15 — what a screen reader hears for the principal chip: a whole phrase by design
    "principalSpoken", "principalNoneSpoken"],
};
