/**
 * Every word of Where to coach and Who to coach first (bd-17v39c.4.14), in English and Urdu. Read with
 * `useCopy(WHERE)`; `ur` is typed to `en`'s exact shape, so a missing key fails the build. The tips, the check-in
 * questions, blockers and support lines are DATA (the server's content library), not here.
 *
 * The words are Rifat's (School Card Spec rev 18 and her prototype, 28 Oct), in the app's vocabulary (ontology): her
 * "DC sessions" read "DC observations", her "HITL" reads "coach observations", and scores say whose they are.
 *
 * URDU: her Urdu where she wrote it (headings, the four steps, the why lines, the check-in, What to try, Your focus,
 * کہاں کوچنگ کریں, پلان پر کتنا عمل ہوا). The rest is MACHINE-DRAFTED and waits for a native check (verdict
 * NATIVE-CHECK), like the School card's other copy. The who-to-coach-first group names are new words (ours).
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";
import type { CopyEntry } from "../../teacher/copyRegistry";

type U = "today" | "week" | "month";

export const WHERE_EN = {
  title: "Where to coach",
  never: "Only you see this · never shared",
  counts: (dc: number, coach: number) => `${dc} DC · ${coach} coach ${coach === 1 ? "observation" : "observations"}`,
  /** "this month", the period in a line */
  unit: { today: "today", week: "this week", month: "this month" } as Record<U, string>,
  early: "Based on one session — an early signal",
  coachOnly: "No Digital Coaching in this period: from coach observations only",
  empty: "Choose a longer period to see where to coach.",

  convoH: "How to run the conversation",
  c1h: "Start with a strength",
  c1: (code: string, name: string, avg: string) => `${code} ${name} went well in her sessions (${avg}).`,
  c1None: "Ask her what went well in her last lesson.",
  c2h: "Pick one focus",
  c3h: "Show it, then let her try",
  c4h: "Agree the next step",
  c4: (code: string) => `Record one DC observation this week while trying this. Look at ${code} together on your next visit.`,
  convoNote: "Talk about one focus at a time. Bring up a second one only if there is time.",
  whyLabel: "Why this one:",
  whyBoth: "The AI coach and the human coach both scored it low.",
  whyLow: (k: number, n: number) => `Low in ${k} of ${n} DC observations.`,
  whyLowCoach: (k: number, n: number) => `Low in ${k} of ${n} coach observations.`,
  whyStep: (step: string) => `Linked to a step she often skips: ${step}.`,
  whyLowest: "Her lowest-scoring practice this period.",

  chkH: "Check in on NIETE use",
  chkSub: "Ask first, then listen. Find out what is getting in the way before offering any help.",
  ask: "Ask",
  listen: "Listen for (tap what she tells you)",
  support: "Support you can offer",
  allGood: (u: string) => `She used every feature ${u}. No check-in needed.`,
  stNone: (u: string) => `Not used ${u}`,
  stDcLow: (n: number, u: string) => `${n} DC ${n === 1 ? "observation" : "observations"} ${u}`,
  stLpLow: (n: number, u: string) => `${n} lesson ${n === 1 ? "plan" : "plans"} ${u}, fewer than most teachers in the school`,
  stTrn: (u: string) => `No training parts ${u}`,
  features: { dc: "Digital Coaching", lp: "Lesson plans", training: "Training", papers: "Assessments" },

  fwH: "Framework sections, weakest first",
  aiScore: "AI score",
  coachScore: "Coach score",
  focusHere: "Focus here",
  differ: "AI and coach differ",

  weakH: "Weakest practices",
  yourFocus: "Your focus",
  lowIn: (k: number, n: number) => `Low in ${k} of ${n} DC observations`,
  lowInCoach: (k: number, n: number) => `Low in ${k} of ${n} coach observations`,
  tryBtn: "What to try",
  lookFor: "Look for in class",
  tryThis: "Try this with her",

  planH: "How closely she followed the plan",
  planLine: (pct: number) => `She followed ${pct}% of the steps in her NIETE lesson plans.`,
  planUsed: (m: number, n: number) => `${m} of her ${n} DC observations used a NIETE lesson plan.`,
  skippedH: "Steps skipped most often",
  skippedRow: (k: number, n: number) => `${k} of ${n} plans`,
  noSkipped: "No steps skipped",
  noPlan: "No NIETE lesson plan was linked to her DC observations.",

  adviceH: "What the AI coach told her last",
  adviceMeta: (day: string) => `Digital Coaching · ${day}`,
  adviceNote: "Reinforce the same message on your visit.",

  sessionsH: "Her DC observations",
  sessionsSub: "Tap one to open its full report",
  weakestTag: (code: string) => `Weakest: ${code}`,
  more: (n: number, u: string) => `+ ${n} more ${u}`,

  // The two doors (Teacher page, School card)
  openWhere: "Where to coach",
  openFirst: "Who to coach first",

  // Who to coach first (ours)
  firstTitle: "Who to coach first",
  teachersN: (n: number) => `${n} ${n === 1 ? "teacher" : "teachers"}`,
  groups: {
    agree_low: "You and the AI coach both scored it low",
    low_most: "Low in most of her lessons",
    no_dc: (u: string) => `No DC observation ${u} · ask what is in the way`,
    one_dc: "One lesson so far · an early signal",
    none: "No low pattern · open with praise",
  },
  lastDc: (d: number | null) => (d == null ? "No DC observation yet" : d === 0 ? "Last DC observation today" : d === 1 ? "Last DC observation 1 day ago" : `Last DC observation ${d} days ago`),
  oneSession: "Based on one session",
  show: (n: number) => `Show ${n}`,
  hide: "Hide",
  howH: "How this order is worked out",
  how: [
    "1 A section both you and the AI coach scored low (her test 1).",
    "2 Her focus practice is low in at least half of 2 or more DC observations (her test 2).",
    "3 No DC observation in the period.",
    "4 One DC observation only: an early signal.",
    "5 None of these.",
    "Inside a group: low in more of her lessons first, then the lower average.",
  ],
};

export type WhereCopy = Words<typeof WHERE_EN>;

export const WHERE_UR: WhereCopy = {
  title: "کہاں کوچنگ کریں",
  never: "صرف آپ کے لیے · کبھی شیئر نہیں ہوتا",
  counts: (dc, coach) => `${dc} DC · کوچ کے ${coach} مشاہدات`,
  unit: { today: "آج", week: "اس ہفتے", month: "اس مہینے" },
  early: "ایک سیشن کی بنیاد پر — ابتدائی اشارہ",
  coachOnly: "اس مدت میں ڈیجیٹل کوچنگ نہیں: صرف کوچ کے مشاہدات سے",
  empty: "کہاں کوچنگ کرنی ہے، دیکھنے کے لیے لمبی مدت چنیں۔",

  convoH: "بات چیت کی ترتیب",
  c1h: "کسی خوبی سے آغاز کریں",
  c1: (code, name, avg) => `ان کے سیشنز میں ${code} ${name} اچھا رہا (${avg})۔`,
  c1None: "ان سے پوچھیں کہ پچھلے سبق میں کیا اچھا رہا۔",
  c2h: "ایک فوکس چنیں",
  c3h: "کر کے دکھائیں، پھر ان سے کروائیں",
  c4h: "اگلا قدم طے کریں",
  c4: (code) => `اس ہفتے یہ طریقہ آزماتے ہوئے ایک DC ریکارڈ کریں۔ اگلی وزٹ پر ${code} مل کر دیکھیں۔`,
  convoNote: "ایک وقت میں ایک ہی فوکس پر بات کریں۔ وقت ہو تو ہی دوسرا لیں۔",
  whyLabel: "یہ کیوں:",
  whyBoth: "AI کوچ اور انسانی کوچ دونوں نے اسے کم اسکور دیا۔",
  whyLow: (k, n) => `${n} میں سے ${k} ڈیجیٹل کوچنگ مشاہدات میں کمزور۔`,
  whyLowCoach: (k, n) => `کوچ کے ${n} میں سے ${k} مشاہدات میں کمزور۔`,
  whyStep: (step) => `اس مرحلے سے جڑا جو وہ اکثر چھوڑ دیتی ہیں: ${step}۔`,
  whyLowest: "اس مدت میں ان کا سب سے کم اسکور والا طریقہ۔",

  chkH: "NIETE کے استعمال پر بات کریں",
  chkSub: "پہلے پوچھیں، پھر سنیں۔ مدد دینے سے پہلے جانیں کہ رکاوٹ کیا ہے۔",
  ask: "پوچھیں",
  listen: "ان باتوں پر دھیان دیں (جو وہ بتائیں اس پر ٹیپ کریں)",
  support: "یہ مدد دی جا سکتی ہے",
  allGood: (u) => `${u} انہوں نے تمام فیچر استعمال کیے۔ اس پر بات کی ضرورت نہیں۔`,
  stNone: (u) => `${u} استعمال نہیں ہوا`,
  stDcLow: (n, u) => `${u} ${n} ڈیجیٹل کوچنگ مشاہدات`,
  stLpLow: (n, u) => `${u} ${n} لیسن پلان، اسکول کے زیادہ تر ٹیچرز سے کم`,
  stTrn: (u) => `${u} ٹریننگ کا کوئی حصہ نہیں`,
  features: { dc: "ڈیجیٹل کوچنگ", lp: "لیسن پلان", training: "ٹریننگ", papers: "پرچے" },

  fwH: "فریم ورک کے حصے، سب سے کمزور پہلے",
  aiScore: "اے آئی اسکور",
  coachScore: "کوچ اسکور",
  focusHere: "یہاں توجہ دیں",
  differ: "AI اور کوچ میں فرق",

  weakH: "سب سے کمزور طریقے",
  yourFocus: "آپ کا فوکس",
  lowIn: (k, n) => `${n} میں سے ${k} ڈیجیٹل کوچنگ مشاہدات میں کمزور`,
  lowInCoach: (k, n) => `کوچ کے ${n} میں سے ${k} مشاہدات میں کمزور`,
  tryBtn: "کیا آزمائیں",
  lookFor: "کلاس میں دیکھیں",
  tryThis: "ان کے ساتھ یہ آزمائیں",

  planH: "پلان پر کتنا عمل ہوا",
  planLine: (pct) => `انہوں نے NIETE لیسن پلان کے ${pct}% مراحل پر عمل کیا۔`,
  planUsed: (m, n) => `${n} میں سے ${m} ڈیجیٹل کوچنگ مشاہدات میں NIETE لیسن پلان استعمال ہوا۔`,
  skippedH: "سب سے زیادہ چھوڑے گئے مراحل",
  skippedRow: (k, n) => `${n} میں سے ${k} پلان`,
  noSkipped: "کوئی مرحلہ نہیں چھوڑا گیا",
  noPlan: "ان کے ڈیجیٹل کوچنگ مشاہدات سے کوئی NIETE لیسن پلان نہیں جڑا تھا۔",

  adviceH: "AI کوچ کا آخری مشورہ",
  adviceMeta: (day) => `ڈیجیٹل کوچنگ · ${day}`,
  adviceNote: "اپنے وزٹ میں یہی بات دہرائیں۔",

  sessionsH: "ان کے ڈیجیٹل کوچنگ مشاہدات",
  sessionsSub: "پوری رپورٹ کھولنے کے لیے کسی ایک پر ٹیپ کریں",
  weakestTag: (code) => `سب سے کمزور: ${code}`,
  more: (n, u) => `${u} ${n} مزید`,

  openWhere: "کہاں کوچنگ کریں",
  openFirst: "پہلے کس کی کوچنگ کریں",

  firstTitle: "پہلے کس کی کوچنگ کریں",
  teachersN: (n) => `${n} ٹیچرز`,
  groups: {
    agree_low: "آپ اور AI کوچ دونوں نے کم اسکور دیا",
    low_most: "زیادہ تر اسباق میں کمزور",
    no_dc: (u) => `${u} کوئی ڈیجیٹل کوچنگ مشاہدہ نہیں · رکاوٹ پوچھیں`,
    one_dc: "ابھی ایک ہی سبق · ابتدائی اشارہ",
    none: "کوئی کمزور پیٹرن نہیں · تعریف سے آغاز کریں",
  },
  lastDc: (d) => (d == null ? "ابھی کوئی ڈیجیٹل کوچنگ مشاہدہ نہیں" : d === 0 ? "آخری ڈیجیٹل کوچنگ مشاہدہ آج" : `آخری ڈیجیٹل کوچنگ مشاہدہ ${d} دن پہلے`),
  oneSession: "ایک سیشن کی بنیاد پر",
  show: (n) => `${n} دکھائیں`,
  hide: "چھپائیں",
  howH: "یہ ترتیب کیسے بنتی ہے",
  how: [
    "1 ایسا حصہ جسے آپ اور AI کوچ دونوں نے کم اسکور دیا (ان کا ٹیسٹ 1)۔",
    "2 ان کا فوکس طریقہ 2 یا زیادہ ڈیجیٹل کوچنگ مشاہدات میں سے کم از کم آدھے میں کمزور (ان کا ٹیسٹ 2)۔",
    "3 اس مدت میں کوئی ڈیجیٹل کوچنگ مشاہدہ نہیں۔",
    "4 صرف ایک ڈیجیٹل کوچنگ مشاہدہ: ابتدائی اشارہ۔",
    "5 ان میں سے کچھ نہیں۔",
    "ایک گروپ کے اندر: جو زیادہ اسباق میں کمزور ہو وہ پہلے، پھر کم اوسط۔",
  ],
};

export const WHERE: Bilingual<typeof WHERE_EN> = bilingual(WHERE_EN, WHERE_UR);

export const WHERE_COPY_ENTRY: CopyEntry = {
  screen: "coach · where to coach",
  module: WHERE as Bilingual<unknown>,
  same: [],
  // Her coaching lines are whole sentences by design: they are what the coach is told and why (Rifat's spec).
  longOk: ["never", "early", "coachOnly", "empty", "convoH", "c1", "c1None", "c3h", "c4", "convoNote", "whyBoth", "whyLow", "whyLowCoach",
    "whyStep", "whyLowest", "chkH", "chkSub", "listen", "allGood", "stLpLow", "lowIn", "lowInCoach", "planH", "planLine", "planUsed", "noPlan",
    "adviceH", "adviceNote", "sessionsSub", "counts", "groups", "lastDc", "howH", "how",
    // her labels, which need more words in Urdu than the 4-word rule allows
    "c1h", "c2h", "c4h", "differ", "firstTitle", "openFirst", "fwH", "noSkipped", "oneSession", "sessionsH", "skippedH", "skippedRow", "stDcLow",
    "stTrn", "support", "tryThis"],
};
