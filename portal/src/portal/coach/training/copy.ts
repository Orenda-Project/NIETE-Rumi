/**
 * bd-s42dye.2 — every word of the coach Training Library, in English and Urdu. Labels, 1 to 4 words (the preview
 * banner is the one sentence, listed in longOk). Provider, level, course and part names and the questions are data:
 * they come from the API as they are. Vocabulary: Course and Part (never Module), Level exam, Course exam, Quick
 * check (ontology 3d). The Urdu is MACHINE-DRAFTED and waits for a native check.
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";
import type { CopyEntry } from "../../teacher/copyRegistry";

export const COACH_LIBRARY_EN = {
  title: "Training Library",
  providers: "Providers",
  loading: "Loading",
  loadFailed: "Could not load",
  nothingYet: "Nothing yet",
  courses: (n: number) => (n === 1 ? "1 course" : `${n} courses`),
  parts: (n: number) => (n === 1 ? "1 part" : `${n} parts`),
  minutes: (n: number) => `${n} min`,
  levels: (n: number) => (n === 1 ? "1 level" : `${n} levels`),
  course: "Course",
  part: "Part",
  previewQuestions: "Preview questions",
  previewLevelExam: "Preview level exam",
  previewCourseExam: "Preview course exam",
  /** The one sentence: what a coach can and cannot do with a question list. */
  previewBanner: "Preview only: coaches can read the questions; nothing is submitted",
  question: (n: number) => `Question ${n}`,
  questions: (n: number) => (n === 1 ? "1 question" : `${n} questions`),
  noQuestions: "No questions",
  typeOne: "Select one",
  typeMany: "Select all",
  typeWritten: "Written answer",
  video: "Video",
  audio: "Audio",
  handout: "Handout",
  pdf: "PDF",
  quickCheck: "Quick check",
  requiredReading: "Required reading",
  notAvailable: "Not available",
  open: "Open",
  by: (author: string) => `By ${author}`,
};

export const COACH_LIBRARY_UR: Words<typeof COACH_LIBRARY_EN> = {
  title: "ٹریننگ لائبریری",
  providers: "ادارے",
  loading: "لوڈ ہو رہا ہے",
  loadFailed: "لوڈ نہیں ہو سکا",
  nothingYet: "ابھی کچھ نہیں",
  courses: (n: number) => `${n} کورس`,
  parts: (n: number) => `${n} حصہ`,
  minutes: (n: number) => `${n} منٹ`,
  levels: (n: number) => `${n} درجہ`,
  course: "کورس",
  part: "حصہ",
  previewQuestions: "سوالات دیکھیں",
  previewLevelExam: "درجے کا امتحان دیکھیں",
  previewCourseExam: "کورس کا امتحان دیکھیں",
  previewBanner: "صرف جائزہ: کوچ سوالات پڑھ سکتے ہیں، کچھ جمع نہیں ہوتا",
  question: (n: number) => `سوال ${n}`,
  questions: (n: number) => `${n} سوال`,
  noQuestions: "کوئی سوال نہیں",
  typeOne: "ایک منتخب کریں",
  typeMany: "سب منتخب کریں",
  typeWritten: "تحریری جواب",
  video: "ویڈیو",
  audio: "آڈیو",
  handout: "ہینڈ آؤٹ",
  pdf: "PDF",
  quickCheck: "فوری جانچ",
  requiredReading: "لازمی مطالعہ",
  notAvailable: "دستیاب نہیں",
  open: "کھولیں",
  by: (author: string) => `${author} کی طرف سے`,
};

export const COACH_LIBRARY = bilingual(COACH_LIBRARY_EN, COACH_LIBRARY_UR);

export const COPY_ENTRY: CopyEntry = {
  screen: "Coach Training Library",
  module: COACH_LIBRARY as Bilingual<unknown>,
  same: ["pdf"],
  longOk: ["previewBanner"],
};
