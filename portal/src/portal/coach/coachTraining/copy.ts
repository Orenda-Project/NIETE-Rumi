/**
 * The words of Coach Training, in English and Urdu. "Coach Training" / «کوچ ٹریننگ» is the operator's name for it (plan
 * approved 3 Nov) and is kept apart from the teacher Training Library («ٹریننگ لائبریری»). "Module" / «ماڈیول» is the
 * programme's own word for its parts (the teacher app says Course and Part; this is the coach's programme, not
 * Training). The module titles are the programme's own, in modules.ts. Urdu MACHINE-DRAFTED where not the programme's.
 */
import { bilingual, type Bilingual } from "../../teacher/i18n";
import type { CopyEntry } from "../../teacher/copyRegistry";

export const COACH_TRAINING_EN = {
  title: "Coach Training",
  crumb: "Home",
  /* bd-rlxkkt.12 — ten since Module 10 (No evidence, no level), which is not a debrief module */
  coachIntro: "Ten coaching modules",
  coachModule: "Module",
  pdf: "PDF",
  video: "Video",
  /* bd-rlxkkt.12 — under Video while a module's video is still being made (Module 10) */
  videoSoon: "Coming soon",
  /* bd-rlxkkt.9 — marking a module done: the Training Library's own words (Mark done, Done, Not saved) */
  markDone: "Mark done",
  markNotDone: "Mark not done",
  done: "Done",
  doneOf: (n: number, total: number) => `${n} of ${total} done`,
  notSaved: "Not saved",
  opensInBrowser: "Opens in your browser",
};

const COACH_TRAINING_UR: typeof COACH_TRAINING_EN = {
  title: "کوچ ٹریننگ",
  crumb: "ہوم",
  coachIntro: "کوچنگ کے دس ماڈیول",
  coachModule: "ماڈیول",
  pdf: "پی ڈی ایف",
  video: "ویڈیو",
  videoSoon: "جلد آ رہی ہے",
  markDone: "مکمل کریں",
  markNotDone: "نامکمل کریں",
  done: "مکمل",
  doneOf: (n: number, total: number) => `${n}/${total} مکمل`,
  notSaved: "محفوظ نہیں ہوا",
  opensInBrowser: "براؤزر میں کھلے گا",
};

export const COACH_TRAINING = bilingual(COACH_TRAINING_EN, COACH_TRAINING_UR);

export const COPY_ENTRY: CopyEntry = {
  screen: "Coach Training",
  module: COACH_TRAINING as Bilingual<unknown>,
  longOk: ["coachIntro"],
};
