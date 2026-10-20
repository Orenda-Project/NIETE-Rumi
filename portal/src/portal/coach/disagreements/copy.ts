/**
 * bd-tbprit.3 — every word the coach's disagreement screens show (the list and one teacher's card).
 *
 * Bilingual: DISAGREE = { en, ur }, read with useCopy(DISAGREE); `ur` is typed to en's exact SHAPE. The four
 * list's words are Rifat's prototype, Urdu included (bd-tbprit.7). The four
 * reasons' Urdu is the teacher's own button copy (dashboard/services/coach-ping-reasons.js); the rest is
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
  arrow: " → ",
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
  },
  doneBadge: "✓ Done",
  allDone: "All done. No teacher is waiting.",
  noneMarkedDone: "No card marked done yet.",
  reason: {
    score: "Score doesn't seem right",
    missed: "Report missed what I did",
    wont_work: "Won't work in class",
    unclear: "Didn't understand what to do",
  },
  aiPct: (n: number) => `AI score ${n}%`,
  aiOf: (n: number, max: number) => `AI score ${n}/${max}`,
  hasNote: "Voice note",

  /* the card */
  disagreesWith: "What she disagrees with",
  herNote: "Her voice note",
  planNotChecked: "Plan not checked",
  planSteps: "Plan steps",
  reportSaid: "The report told her",
  didWell: "Did well",
  thingToTry: "Thing to try",
  listen: "Listen",
  clipLabel: "The lesson at this moment",
  whereToLook: "Where to look",
  trend: "Her scores",
  fullReport: "Full DC report",
  sectionName: {
    lesson_plan_fidelity: "Lesson Plan Fidelity",
    high_leverage_practices: "High Leverage Practices",
    student_engagement: "Student Engagement",
    teacher_subject_knowledge: "Subject Knowledge",
  },
  visit: "I have visited",
  visited: "Visited",
  saveFailed: "Could not save",
};

const UR: Words<typeof EN> = {
  title: "اختلافات",
  crumb: "رپورٹس",
  entry: "اساتذہ جنہوں نے اختلاف کیا",
  dash: "—",
  arrow: " → ",
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
  aiPct: (n: number) => `AI اسکور ${n}%`,
  aiOf: (n: number, max: number) => `AI اسکور ${n}/${max}`,
  hasNote: "وائس نوٹ",

  disagreesWith: "وہ کس بات سے متفق نہیں",
  herNote: "ان کا وائس نوٹ",
  planNotChecked: "پلان چیک نہیں ہوا",
  planSteps: "پلان کے مراحل",
  reportSaid: "رپورٹ نے انہیں کہا",
  didWell: "اچھا کیا",
  thingToTry: "آزمانے کی بات",
  listen: "سنیں",
  clipLabel: "اس لمحے کا سبق",
  whereToLook: "کہاں دیکھیں",
  trend: "ان کے اسکور",
  fullReport: "مکمل DC رپورٹ",
  sectionName: {
    lesson_plan_fidelity: "سبق کے منصوبے پر عمل",
    high_leverage_practices: "مؤثر تدریسی طریقے",
    student_engagement: "طلبہ کی شمولیت",
    teacher_subject_knowledge: "مضمون کا علم",
  },
  visit: "میں نے دورہ کر لیا",
  visited: "دورہ ہو گیا",
  saveFailed: "محفوظ نہیں ہو سکا",
};

export const DISAGREE = bilingual(EN, UR);
