/**
 * bd-o15qnr.28 (queue #204, v7) — the words the Feedback Form review screens add in the v7 look (#188's canvas, LOCK
 * round, "Screens #206 found with no design", row 10; boards m9-ff-v6, m9-ff-v6-ur, m9-ff-save, m9-ff-fico-s, m9-ff-fde,
 * p9-ff-v6). Words already in the app are reused from their own files (reports/copy.ts: To improve, From the recording,
 * N/A, Couldn't tell, Coach score, Next part, Back, Save Feedback Form, Save and continue, Keep checking; flow/copyV7.ts:
 * Now: Fill the form, Form filled, Record the debrief). Never him or her: the teacher's name, or "the teacher".
 * Urdu MACHINE-DRAFTED: NATIVE-CHECK (the m9-ff-v6-ur board's words where it had them).
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";

const levelsEn = (n: number) => (n === 1 ? "1 level" : `${n} levels`);
const notesEn = (n: number) => (n === 1 ? "1 note" : `${n} notes`);

export const FORM_V7_COPY = {
  /* the legend: whose level is which (the coach's "Coach score", reports/copy.ts; the principal's own) */
  yourLevel: "Your level",
  rumisLevel: "Rumi’s level",
  /* the word at the end of Rumi's row: a name, the same in Urdu */
  rumiTag: "Rumi",

  /* one indicator */
  evidence: "Evidence",
  changedFrom: (was: string) => `Changed from ${was}`,
  whyLevelMin: (n: number) => `Why this level (${n} letters at least)`,
  whyChanged: "Why you changed it",

  /* the Save tray */
  ratings: (n: number) => (n === 1 ? "1 rating" : `${n} ratings`),
  changedSummary: (levels: number, notes: number, fromRumi: boolean) =>
    `${levelsEn(levels)} and ${notesEn(notes)} changed${fromRumi ? " from Rumi’s" : ""}`,
  nextStep: (step: string) => `Next: ${step}`,

  /* FICO-S v1.1 and FDE: saved part by part */
  savedAt: (time: string) => `Saved ${time}`,
  savedPartByPart: "Saved part by part: leave and come back without losing anything.",
  noRumiLevels: "You choose every level here: no Rumi levels on this form.",
  gradeShort: (g: number) => `G${g}`,
} as const;

export type FormV7Copy = Words<typeof FORM_V7_COPY>;

// NATIVE-CHECK (bd-o15qnr.28, machine-drafted; the m9-ff-v6-ur board's words where it had them)
export const FORM_V7_COPY_UR: FormV7Copy = {
  yourLevel: "آپ کی سطح",
  rumisLevel: "AI اسکور",
  rumiTag: "Rumi",

  evidence: "شواہد",
  changedFrom: (was: string) => `${was} سے بدلا گیا`,
  whyLevelMin: (n: number) => `یہ سطح کیوں (کم از کم ${n} حروف)`,
  whyChanged: "آپ نے کیوں بدلا",

  ratings: (n: number) => `${n} ریٹنگ`,
  changedSummary: (levels: number, notes: number, fromRumi: boolean) =>
    `${levels} ${levels === 1 ? "سطح" : "سطحیں"} اور ${notes} نوٹ${fromRumi ? " Rumi سے" : ""} بدلے گئے`,
  nextStep: (step: string) => `اگلا: ${step}`,

  savedAt: (time: string) => `${time} پر محفوظ`,
  savedPartByPart: "حصہ حصہ محفوظ ہوتا ہے: جا کر واپس آئیں، کچھ ضائع نہیں ہو گا۔",
  noRumiLevels: "یہاں ہر سطح آپ چنیں: اس فارم پر Rumi کی سطحیں نہیں۔",
  gradeShort: (g: number) => `جماعت ${g}`,
};

export const FORM_V7 = bilingual(FORM_V7_COPY, FORM_V7_COPY_UR);

/** Lines the boards print word for word: past the 4-word label rule. */
const LONG_OK: readonly string[] = ["whyLevelMin", "changedSummary", "savedPartByPart", "noRumiLevels"];
const SAME: readonly string[] = ["rumiTag"];

export const COPY_ENTRY = { screen: "Coach · Feedback Form (v7)", module: FORM_V7 as Bilingual<unknown>, same: SAME, longOk: LONG_OK } as const;
