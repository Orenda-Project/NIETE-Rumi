/**
 * bd-tbprit.3 — every word the coach's disagreement screens show (the list and one teacher's card).
 *
 * Bilingual: DISAGREE = { en, ur }, read with useCopy(DISAGREE); `ur` is typed to en's exact SHAPE. The four
 * list's words are Rifat's prototype, Urdu included (bd-tbprit.7); so is the card's top (bd-tbprit.8). The four
 * reasons are in the teacher's own voice, as Rifat words them; their Urdu is the teacher's own button copy (dashboard/services/coach-ping-reasons.js); the rest is
 * MACHINE-DRAFTED and awaits a native check. Scores always say "AI score" — never HITL (niete-portal rule).
 *
 * DATA is not copy: names, schools, indicator names and the grader's quotes come from the API as they are.
 */

import { bilingual, type Words } from "../../teacher/i18n";

const ordinal = (n: number) => {
  const t = n % 100;
  const suffix = t >= 11 && t <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
};
const URDU_NTH: Record<number, string> = { 2: "دوسری", 3: "تیسری", 4: "چوتھی", 5: "پانچویں" };

const EN = {
  title: "Disagreements",
  crumb: "Reports",
  entry: "Teachers who disagreed",
  dash: "—",
  todo: "To do",
  done: "Done",
  noneWaiting: "No one is waiting",
  noneDone: "None visited yet",

  /* the list, as Rifat's prototype words it (bd-tbprit.7) */
  appName: "NIETE Teaching Assistant",
  appRole: "Coach · ICT Islamabad",
  listTitle: "Teachers who sent you their report",
  back: "Back",
  notSaved: "Not saved",
  todoTab: (n: number) => `To do · ${n}`,
  doneTab: (n: number) => `Done · ${n}`,
  schoolEmis: (school: string, emis: string) => `${school} · EMIS ${emis}`,
  tag: {
    recordingLess: (before: number, now: number) => `📉 Recording less: ${before} → ${now} a week`,
    waiting: (days: number) => `⏳ Sent ${days} days ago`,
    repeat: (nth: number) => `🔁 ${ordinal(nth)} time disagreeing`,
    short: (min: number) => `🎙 Short recording: ${min} min`,
  },
  doneBadge: "✓ Done",
  allDone: "All done. No teacher is waiting.",
  noneMarkedDone: "No card marked done yet.",
  reason: {
    score: "My score doesn't seem right",
    missed: "I did this, but the report missed it",
    wont_work: "This won't work in my class",
    unclear: "I didn't understand what to do",
  },

  /* the card's top, as Rifat's prototype words it (bd-tbprit.8) */
  cardSub: "Disagrees with report · review",
  group: (g: string) => `Group ${g}`,
  disagrees: (name: string) => `⚑ ${name} doesn't agree with this report`,
  reasonCount: (n: number) => (n === 1 ? "1 reason" : `${n} reasons`),
  plusNote: " + voice note",
  sentAt: (when: string) => `sent ${when}`,
  nthTime: (n: number) => (n <= 1 ? "first time" : `${ordinal(n)} time`),
  aiPct: (n: number) => `AI score ${n}%`,
  aiOf: (n: number, max: number) => `AI score ${n}/${max}`,
  hasNote: "Voice note",

  /* the card */
  disagreesWith: "A. What she disagrees with",
  herNote: "🎙 Her message to you, in her own voice",
  planNotChecked: "Plan not checked",
  /* bd-tbprit.14 — Rifat's one score line; the detail is in B and the full report */
  scoreSub: "Score she questions",
  scoreLowest: (name: string, pct: number) => ` · lowest: ${name} (${pct}%). Details in B.`,
  scoreNoPlan: " · Lesson Plan Fidelity not checked (no plan linked), so it is left out of the score. Details in B.",
  scoreDetails: " · Details in B.",
  planSteps: "Plan steps",
  reportSaid: "What the report told her",
  didWell: "Strength",
  thingToTry: "One thing to try",
  listen: "Listen",
  clipLabel: "The lesson at this moment",
  whereToLook: "Where to look",
  fullReport: "Full DC report",
  sectionName: {
    lesson_plan_fidelity: "Lesson Plan Fidelity",
    high_leverage_practices: "High Leverage Practices",
    student_engagement: "Student Engagement",
    teacher_subject_knowledge: "Subject Knowledge",
  },
  /* B. Where to look, as Rifat's prototype and her 20 Oct review word it (bd-tbprit.9) */
  where: {
    title: "B. Where to look",
    tag: "evidence",
    recording: (t: string) => `Recording · ${t}`,
    listenStep: (step: string, from: string, to: string) => `▶ Listen to ${step} · ${from} – ${to}`,
    listenPart: (from: string, to: string) => `▶ Listen · ${from} – ${to}`,
    listenFor: (what: string) => `Listen for: ${what}`,
    notInRecording: (t: string) => `This part is not in the recording. The recording stopped at ${t}.`,
    short: (min: number, t: string) => `🎙 Short recording: only ${min} minutes were recorded (less than 15). Nothing after ${t} is in the report.`,
    sections: "Performance by section",
    sectionsHint: "Tap a section to see its details",
    lowest: "lowest",
    disputed: "disputed",
    notChecked: "not checked",
    tapMoves: "Tap to see the lesson plan moves",
    mvTotal: "moves in her lesson plan",
    mvDone: "moves she did",
    mvPct: "of moves done",
    yes: "Yes",
    partial: "Partial",
    no: "No",
    key: "★ key move",
    mostMissed: "most missed",
    notRecorded: "not recorded (not counted)",
    indicators: (n: number, at: Record<number, number>, none: number) =>
      [`${n} FICO indicators, scored 1–4`, ...[4, 3, 2, 1].filter((k) => at[k]).map((k) => `${at[k]} at ${k}`), ...(none ? [`${none} no detail`] : [])].join(" · "),
    noDetail: "No detail for this indicator in the report",
  },
  markDone: "✓ Mark as done",
  doneHint: "Tap when you have coached her. The card moves to Done.",
  doneBadge: "✓ Done",
  undo: "Move back to To do",
  moved: (n: string) => `${n} moved to Done.`,
  backMsg: (n: string) => `${n} is back in To do.`,
  saveFailed: "Could not save",
};

const UR: Words<typeof EN> = {
  title: "اختلافات",
  crumb: "رپورٹس",
  entry: "اساتذہ جنہوں نے اختلاف کیا",
  dash: "—",
  todo: "کرنا ہے",
  done: "مکمل",
  noneWaiting: "کوئی انتظار میں نہیں",
  noneDone: "ابھی کوئی دورہ نہیں",

  appName: "NIETE Teaching Assistant",
  appRole: "کوچ · آئی سی ٹی اسلام آباد",
  listTitle: "جن اساتذہ نے آپ کو رپورٹ بھیجی",
  back: "واپس",
  notSaved: "محفوظ نہیں ہوا",
  todoTab: (n: number) => `باقی · ${n}`,
  doneTab: (n: number) => `مکمل · ${n}`,
  schoolEmis: (school: string, emis: string) => `${school} · EMIS ${emis}`,
  tag: {
    recordingLess: (before: number, now: number) => `📉 ریکارڈنگ کم: ہفتے میں ${before} سے ${now}`,
    waiting: (days: number) => `⏳ ${days} دن پہلے بھیجا`,
    repeat: (nth: number) => `🔁 ${URDU_NTH[nth] ?? `${nth}ویں`} بار اختلاف`,
    short: (min: number) => `🎙 مختصر ریکارڈنگ: ${min} منٹ`,
  },
  doneBadge: "✓ مکمل",
  allDone: "سب مکمل۔ کوئی استاد انتظار میں نہیں۔",
  noneMarkedDone: "ابھی کوئی کارڈ مکمل نہیں ہوا۔",
  reason: {
    score: "میرا اسکور درست نہیں لگتا",
    missed: "میں نے یہ کیا تھا، رپورٹ نے نہیں پکڑا",
    wont_work: "یہ کام میری کلاس میں ممکن نہیں",
    unclear: "سمجھ نہیں آیا کہ کرنا کیا ہے",
  },

  cardSub: "رپورٹ سے اختلاف · جائزہ",
  group: (g: string) => `گروپ ${g}`,
  disagrees: (name: string) => `⚑ ${name} اس رپورٹ سے متفق نہیں`,
  reasonCount: (n: number) => (n === 1 ? "1 وجہ" : `${n} وجوہات`),
  plusNote: " + وائس نوٹ",
  sentAt: (when: string) => `بھیجا ${when}`,
  nthTime: (n: number) => (n <= 1 ? "پہلی بار" : `${URDU_NTH[n] ?? `${n}ویں`} بار`),
  aiPct: (n: number) => `AI اسکور ${n}%`,
  aiOf: (n: number, max: number) => `AI اسکور ${n}/${max}`,
  hasNote: "وائس نوٹ",

  disagreesWith: "A. وہ کس بات سے متفق نہیں",
  herNote: "🎙 آپ کے لیے ان کا پیغام، ان کی اپنی آواز میں",
  planNotChecked: "پلان چیک نہیں ہوا",
  scoreSub: "جس اسکور پر اعتراض ہے",
  scoreLowest: (name: string, pct: number) => ` · سب سے کم: ${name} (${pct}%)۔ تفصیل B میں۔`,
  scoreNoPlan: " · سبق کے منصوبے پر عمل جانچا نہیں گیا (پلان نہیں جڑا تھا)، اس لیے اسکور میں شامل نہیں۔ تفصیل B میں۔",
  scoreDetails: " · تفصیل B میں۔",
  planSteps: "پلان کے مراحل",
  reportSaid: "رپورٹ نے انہیں کیا کہا",
  didWell: "خوبی",
  thingToTry: "آزمانے کی ایک بات",
  listen: "سنیں",
  clipLabel: "اس لمحے کا سبق",
  whereToLook: "کہاں دیکھیں",
  fullReport: "مکمل DC رپورٹ",
  sectionName: {
    lesson_plan_fidelity: "سبق کے منصوبے پر عمل",
    high_leverage_practices: "مؤثر تدریسی طریقے",
    student_engagement: "طلبہ کی شمولیت",
    teacher_subject_knowledge: "مضمون کا علم",
  },
  where: {
    title: "B. کہاں دیکھیں",
    tag: "ثبوت",
    recording: (t: string) => `ریکارڈنگ · ${t}`,
    listenStep: (step: string, from: string, to: string) => `▶ ${step} سنیں · ${from} – ${to}`,
    listenPart: (from: string, to: string) => `▶ سنیں · ${from} – ${to}`,
    listenFor: (what: string) => `یہ سنیں: ${what}`,
    notInRecording: (t: string) => `یہ حصہ ریکارڈنگ میں نہیں۔ ریکارڈنگ ${t} پر رک گئی۔`,
    short: (min: number, t: string) => `🎙 مختصر ریکارڈنگ: صرف ${min} منٹ ریکارڈ ہوئے (15 سے کم)۔ ${t} کے بعد کا کچھ رپورٹ میں نہیں۔`,
    sections: "حصہ وار کارکردگی",
    sectionsHint: "تفصیل دیکھنے کے لیے کسی حصے پر ٹیپ کریں",
    lowest: "سب سے کم",
    disputed: "متنازع",
    notChecked: "جانچ نہیں ہوئی",
    tapMoves: "لیسن پلان کے موو دیکھنے کے لیے ٹیپ کریں",
    mvTotal: "لیسن پلان میں کل موو",
    mvDone: "موو جو ٹیچر نے کیے",
    mvPct: "موو مکمل",
    yes: "ہاں",
    partial: "جزوی",
    no: "نہیں",
    key: "★ اہم موو",
    mostMissed: "سب سے زیادہ رہ گئے",
    notRecorded: "ریکارڈ نہیں ہوئے (شمار نہیں)",
    indicators: (n: number, at: Record<number, number>, none: number) =>
      [`${n} FICO indicators، اسکور 1–4`, ...[4, 3, 2, 1].filter((k) => at[k]).map((k) => `${at[k]} پر ${k}`), ...(none ? [`${none} بغیر تفصیل`] : [])].join(" · "),
    noDetail: "رپورٹ میں اس indicator کی تفصیل نہیں",
  },
  markDone: "✓ مکمل کریں",
  doneHint: "کوچنگ کے بعد ٹیپ کریں۔ کارڈ «مکمل» میں چلا جائے گا۔",
  doneBadge: "✓ مکمل",
  undo: "واپس «باقی» میں",
  moved: (n: string) => `${n} «مکمل» میں چلی گئیں۔`,
  backMsg: (n: string) => `${n} واپس «باقی» میں ہیں۔`,
  saveFailed: "محفوظ نہیں ہو سکا",
};

export const DISAGREE = bilingual(EN, UR);
