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
  coachIntro: "Nine debrief modules",
  coachModule: "Module",
  opensInBrowser: "Opens in your browser",
};

const COACH_TRAINING_UR: typeof COACH_TRAINING_EN = {
  title: "کوچ ٹریننگ",
  crumb: "ہوم",
  coachIntro: "ڈی بریف کے نو ماڈیول",
  coachModule: "ماڈیول",
  opensInBrowser: "براؤزر میں کھلے گا",
};

export const COACH_TRAINING = bilingual(COACH_TRAINING_EN, COACH_TRAINING_UR);

export const COPY_ENTRY: CopyEntry = {
  screen: "Coach Training",
  module: COACH_TRAINING as Bilingual<unknown>,
  longOk: ["coachIntro"],
};
