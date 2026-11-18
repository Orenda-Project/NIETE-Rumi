/**
 * bd-4404s7.2 — every word of the coach Home (and its "reports waiting" notice), in English and Urdu.
 * Labels only: 1 to 4 words. Names, schools, times and numbers are data and come from the API as they are.
 * The Urdu is MACHINE-DRAFTED (COACH.md §5, the Coach_Home_Urdu board) and waits for a native check
 * (workbench/teacher-v2-impl/urdu-review/urdu-review.tsv, verdict NATIVE-CHECK).
 * The brand, the greeting, the date and Training's word are the frame's (teacher/copy.ts).
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";
import type { CopyEntry } from "../../teacher/copyRegistry";

export const COACH_HOME_EN = {
  todaysVisits: "Today's visits",
  noVisits: "No visits",
  loadFailed: "Could not load",
  takeObservation: "Take observation",
  /** bd-o15qnr.26 — the Today card's button (flow v2): straight to the next visit's recording. */
  startRecording: "Start recording",
  done: "Done",
  now: "Now",
  inHours: (h: number) => `In ${h} h`,
  reportsWaiting: (n: number) => (n === 1 ? "1 observation needs you" : `${n} observations need you`),
  tiles: {
    schedule: "Schedule",
    observe: "Observe",
    /** bd-o15qnr.26 — the second tile with the visit flow v2 switch on: her observations (the menu's word). */
    observations: "Observations",
    schools: "Schools & teachers",
    analytics: "Analytics",
  },
  chips: {
    thisWeek: (n: number) => `${n} this week`,
    waiting: (n: number) => `${n} waiting`,
    teachers: (n: number) => `${n} teachers`,
  },
};

export const COACH_HOME_UR: Words<typeof COACH_HOME_EN> = {
  todaysVisits: "آج کے دورے",
  noVisits: "کوئی دورہ نہیں",
  loadFailed: "لوڈ نہیں ہو سکا",
  takeObservation: "مشاہدہ لیں",
  startRecording: "ریکارڈنگ شروع کریں",
  done: "مکمل",
  now: "ابھی",
  inHours: (h: number) => `${h} گھنٹے میں`,
  reportsWaiting: (n: number) => (n === 1 ? "1 مشاہدہ منتظر" : `${n} مشاہدات منتظر`),
  tiles: {
    schedule: "شیڈول",
    observe: "مشاہدہ",
    observations: "مشاہدات",
    schools: "اسکول اور ٹیچرز",
    analytics: "تجزیہ",
  },
  chips: {
    thisWeek: (n: number) => `اس ہفتے ${n}`,
    waiting: (n: number) => `${n} منتظر`,
    teachers: (n: number) => `${n} ٹیچرز`,
  },
};

export const COACH_HOME = bilingual(COACH_HOME_EN, COACH_HOME_UR);
export type CoachHomeCopy = Words<typeof COACH_HOME_EN>;

export const COPY_ENTRY: CopyEntry = {
  screen: "Coach Home",
  module: COACH_HOME as Bilingual<unknown>,
};
