/**
 * bd-o15qnr.28 (queue #204, v7) — the words the Feedback Form review screens add in the v7 look (#188's canvas, LOCK
 * round, "Screens #206 found with no design", row 10; boards m9-ff-v6, m9-ff-v6-ur, m9-ff-save, m9-ff-fico-s, m9-ff-fde,
 * p9-ff-v6). Words already in the app are reused from their own files (reports/copy.ts: To improve, From the recording,
 * N/A, Couldn't tell, Coach score, Next part, Back, Save Feedback Form, Save and continue, Keep checking; flow/copyV7.ts:
 * Now: Fill the form, Form filled, Record the debrief). Never him or her: the teacher's name, or "the teacher".
 * Urdu MACHINE-DRAFTED: NATIVE-CHECK (the m9-ff-v6-ur board's words where it had them).
 *
 * bd-o15qnr.31 (#188, 21 Nov: the Feedback Form review; evidence option B with editing, LOCKED ~10:05) — the words of
 * the collapsed form (sections, one row per indicator, one indicator alone), the evidence rows (Edit / Remove / Undo,
 * Add evidence, the summary edited in place) and the gaps toast; boards ff-outer, ff-list, ff-detail, ff-b-menu,
 * ff-b-removed, ff-b-add (+ -p, -ur). The AI is the "NIETE Teaching Assistant" (Urdu as the bot spells it,
 * observe-strings.js v6f_rumi_chose), never "Rumi". Urdu MACHINE-DRAFTED: NATIVE-CHECK (the -ur boards' words where
 * they had them).
 *
 * bd-o15qnr.36 (#204, the operator 21 Nov ~14:20-14:30) — the AI is the "Digital Coach" (Urdu ڈیجیٹل کوچ) on these
 * screens, no longer "NIETE Teaching Assistant"; the legend reads "You · Digital Coach"; the six combined indicators'
 * box: "The Digital Coach can't count this one. You decide.", "Nothing for this in the recording", "You add: …", the
 * note optional. Urdu MACHINE-DRAFTED: NATIVE-CHECK.
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";

const levelsEn = (n: number) => (n === 1 ? "1 level" : `${n} levels`);
const notesEn = (n: number) => (n === 1 ? "1 note" : `${n} notes`);

export const FORM_V7_COPY = {
  /* the legend: whose level is which (the coach's "Coach score", reports/copy.ts; the principal's own) */
  yourLevel: "Your level",
  /* bd-o15qnr.36: the AI is the Digital Coach on this form, never "Rumi" (EN + UR; was NIETE Teaching Assistant) */
  rumisLevel: "Digital Coach’s level",
  /* the words at the end of the Digital Coach's row */
  rumiTag: "Digital Coach",
  /* the legend: "You · Digital Coach", the coach's and the principal's alike */
  legendYou: "You",
  legendDc: "Digital Coach",

  /* one indicator */
  evidence: "Evidence",
  changedFrom: (was: string) => `Changed from ${was}`,
  whyLevelMin: (n: number) => `Why this level (${n} letters at least)`,
  whyChanged: "Why you changed it",
  /* bd-o15qnr.36: one of the six — the Digital Coach can't count it */
  cantCount: "The Digital Coach can't count this one. You decide.",
  nothingInRecording: "Nothing for this in the recording",
  recIe: "The recording couldn't show this.",
  recNa: "The recording didn't find this in the lesson.",
  recStarred: "★ Starred: the Digital Coach doesn't listen for this one.",
  d2Turns: (a: number, b: number) => `${a} student turns in the first half and ${b} in the second. It can't tell how many different children spoke.`,
  youAdd: (t: string) => `You add: ${t}`,
  noteOptional: "Your note (optional)",

  /* the Save tray */
  ratings: (n: number) => (n === 1 ? "1 rating" : `${n} ratings`),
  changedSummary: (levels: number, notes: number, fromRumi: boolean) =>
    `${levelsEn(levels)} and ${notesEn(notes)} changed${fromRumi ? " from the Digital Coach’s" : ""}`,
  nextStep: (step: string) => `Next: ${step}`,

  /* FICO-S v1.1 and FDE: saved part by part */
  savedAt: (time: string) => `Saved ${time}`,
  savedPartByPart: "Saved part by part: leave and come back without losing anything.",
  noRumiLevels: "You choose every level here: no Digital Coach levels on this form.",
  gradeShort: (g: number) => `G${g}`,

  /* bd-o15qnr.31 (#188, 21 Nov: the Feedback Form review, LOCKED ~10:05) — every section collapsed */
  doneOf: (n: number, m: number) => `${n}/${m} done`,
  checkedOf: (n: number, m: number) => `${n} of ${m} checked`,
  markDone: "Checked",
  markTodo: "To check",
  saveLeft: (n: number) => (n === 1 ? "Save (1 section to finish)" : `Save (${n} sections to finish)`),
  nextToCheck: (code: string, name: string) => `Next to check: ${code} ${name}`,
  doneChecking: "Done",
  yoursToSet: "Yours to set",
  indicatorCrumb: (lead: string, letter: string, i: number, n: number) => `${lead} · ${letter} · ${i} of ${n}`,
  prevIndicator: "Previous",
  nextIndicator: "Next",
  agreeNext: "Agree and next",
  /* bd-o15qnr.37: under the indicator's line, opens it in the "?" guide (#217) once the guide has it */
  examples: "Examples",
  /* evidence option B with editing */
  assistantHeard: "Digital Coach heard",
  editSummary: "Edit the summary",
  done: "Done",
  more: "More: edit or remove",
  edit: "Edit",
  remove: "Remove",
  edited: "edited",
  you: "You",
  addEvidence: "Add evidence",
  whatYouSaw: "What you saw",
  timeOptional: "Time (optional)",
  timeFormat: "Time as mm:ss",
  cancel: "Cancel",
  add: "Add",
  quoteRemoved: "Quote removed",
  undo: "Undo",
  playAt: (t: string) => `Play the lesson at ${t}`,
  pauseAt: (t: string) => `Pause the lesson at ${t}`,
  /* gaps: a short toast, counted */
  needLevel: (n: number) => (n === 1 ? "1 item still needs a level" : `${n} items still need a level`),
  needAnswer: (n: number) => (n === 1 ? "1 item still needs an answer" : `${n} items still need an answer`),
  toCheck: (n: number) => (n === 1 ? "1 item still to check" : `${n} items still to check`),
} as const;

export type FormV7Copy = Words<typeof FORM_V7_COPY>;

// NATIVE-CHECK (bd-o15qnr.28 + bd-o15qnr.31 + bd-o15qnr.36, machine-drafted; the m9-ff-v6-ur and ff-*-ur boards' words where they had them)
export const FORM_V7_COPY_UR: FormV7Copy = {
  yourLevel: "آپ کی سطح",
  rumisLevel: "ڈیجیٹل کوچ کی سطح",
  rumiTag: "ڈیجیٹل کوچ",
  legendYou: "آپ",
  legendDc: "ڈیجیٹل کوچ",

  evidence: "شواہد",
  changedFrom: (was: string) => `${was} سے بدلا گیا`,
  whyLevelMin: (n: number) => `یہ سطح کیوں (کم از کم ${n} حروف)`,
  whyChanged: "آپ نے کیوں بدلا",
  cantCount: "ڈیجیٹل کوچ اسے نہیں گن سکتا۔ آپ طے کریں۔",
  nothingInRecording: "ریکارڈنگ میں اس کے لیے کچھ نہیں",
  recIe: "ریکارڈنگ سے یہ معلوم نہیں ہو سکا۔",
  recNa: "ریکارڈنگ کو سبق میں یہ نہیں ملا۔",
  recStarred: "★ ستارے والا: ڈیجیٹل کوچ اسے نہیں سنتا۔",
  d2Turns: (a: number, b: number) => `پہلے آدھے حصے میں طلبہ ${a} بار بولے اور دوسرے میں ${b} بار۔ ریکارڈنگ یہ نہیں بتا سکتی کہ کتنے مختلف بچے بولے۔`,
  youAdd: (t: string) => `آپ شامل کریں: ${t}`,
  noteOptional: "آپ کا نوٹ (اختیاری)",

  ratings: (n: number) => `${n} ریٹنگ`,
  changedSummary: (levels: number, notes: number, fromRumi: boolean) =>
    `${levels} ${levels === 1 ? "سطح" : "سطحیں"} اور ${notes} نوٹ${fromRumi ? " ڈیجیٹل کوچ سے" : ""} بدلے گئے`,
  nextStep: (step: string) => `اگلا: ${step}`,

  savedAt: (time: string) => `${time} پر محفوظ`,
  savedPartByPart: "حصہ حصہ محفوظ ہوتا ہے: جا کر واپس آئیں، کچھ ضائع نہیں ہو گا۔",
  noRumiLevels: "یہاں ہر سطح آپ چنیں: اس فارم پر ڈیجیٹل کوچ کی سطحیں نہیں۔",
  gradeShort: (g: number) => `جماعت ${g}`,

  doneOf: (n: number, m: number) => `${n}/${m} مکمل`,
  checkedOf: (n: number, m: number) => `${m} میں سے ${n} دیکھ لیے`,
  markDone: "دیکھ لیا",
  markTodo: "دیکھنا باقی",
  saveLeft: (n: number) => `محفوظ کریں (${n} ${n === 1 ? "حصہ" : "حصے"} باقی)`,
  nextToCheck: (code: string, name: string) => `اگلا: ${code} ${name}`,
  doneChecking: "ہو گیا",
  yoursToSet: "آپ طے کریں",
  indicatorCrumb: (lead: string, letter: string, i: number, n: number) => `${lead} · ${letter} · ${n} میں سے ${i}`,
  prevIndicator: "پچھلا",
  nextIndicator: "اگلا",
  agreeNext: "متفق، اگلا",
  examples: "مثالیں",
  assistantHeard: "ڈیجیٹل کوچ نے یہ سنا",
  editSummary: "خلاصہ بدلیں",
  done: "مکمل",
  more: "مزید: بدلیں یا ہٹائیں",
  edit: "بدلیں",
  remove: "ہٹائیں",
  edited: "بدلا گیا",
  you: "آپ",
  addEvidence: "شواہد شامل کریں",
  whatYouSaw: "آپ نے کیا دیکھا",
  timeOptional: "وقت (اختیاری)",
  timeFormat: "وقت mm:ss کی طرح لکھیں",
  cancel: "منسوخ",
  add: "شامل کریں",
  quoteRemoved: "اقتباس ہٹا دیا گیا",
  undo: "واپس لائیں",
  playAt: (t: string) => `${t} سے سبق سنیں`,
  pauseAt: (t: string) => `${t} پر سبق روکیں`,
  needLevel: (n: number) => `${n} ${n === 1 ? "اشاریے" : "اشاریوں"} کی سطح ابھی باقی ہے`,
  needAnswer: (n: number) => `${n} ${n === 1 ? "جگہ" : "جگہیں"} ابھی بھرنی باقی ہیں`,
  toCheck: (n: number) => `${n} ${n === 1 ? "اشاریہ" : "اشاریے"} ابھی دیکھنا باقی`,
};

export const FORM_V7 = bilingual(FORM_V7_COPY, FORM_V7_COPY_UR);

/** Lines the boards print word for word: past the 4-word label rule. */
const LONG_OK: readonly string[] = [
  "whyLevelMin", "changedSummary", "savedPartByPart", "noRumiLevels",
  "saveLeft", "nextToCheck", "indicatorCrumb", "playAt", "pauseAt", "needLevel", "needAnswer", "toCheck",
  "cantCount", "nothingInRecording", "recIe", "recNa", "recStarred", "d2Turns", "youAdd",
];
const SAME: readonly string[] = [];

export const COPY_ENTRY = { screen: "Coach · Feedback Form (v7)", module: FORM_V7 as Bilingual<unknown>, same: SAME, longOk: LONG_OK } as const;
