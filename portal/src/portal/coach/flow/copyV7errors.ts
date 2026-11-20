/**
 * bd-o15qnr.28 (queue #204, v7) — the words of the error cards (#188's board m9-errors: "red edge, one plain line, one
 * button that fixes it"). Words already in the app are reused from their own files (observe/copy.ts: Couldn't send,
 * Try again). Never him or her. Urdu MACHINE-DRAFTED: NATIVE-CHECK.
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";

export const FLOW_V7_ERRORS_COPY = {
  /* 1 · the recording is on this phone; the server never got it */
  notSentYet: "Not sent yet",
  savedOnPhone: (minutes: number | null) => (minutes ? `Your ${minutes}-minute recording is saved on this phone.` : "Your recording is saved on this phone."),
  sendItNow: "Send it now",
  /* 2 · sending stopped */
  nothingLost: "Nothing is lost.",
  /* 3 · the debrief guide could not be made */
  noGuide: "No guide this time",
  noGuideLine: "You can still record the debrief; the feedback comes as usual.",
  recordWithoutGuide: "Record without the guide",
};

export const FLOW_V7_ERRORS_COPY_UR: Words<typeof FLOW_V7_ERRORS_COPY> = {
  notSentYet: "ابھی نہیں بھیجی گئی",
  savedOnPhone: (minutes) => (minutes ? `آپ کی ⁨${minutes}⁩ منٹ کی ریکارڈنگ اسی فون پر محفوظ ہے۔` : "آپ کی ریکارڈنگ اسی فون پر محفوظ ہے۔"),
  sendItNow: "ابھی بھیجیں",
  nothingLost: "کچھ ضائع نہیں ہوا۔",
  noGuide: "اس بار گائیڈ نہیں بنی",
  noGuideLine: "آپ پھر بھی ڈی بریف ریکارڈ کر سکتے ہیں؛ فیڈبیک معمول کے مطابق آئے گی۔",
  recordWithoutGuide: "گائیڈ کے بغیر ریکارڈ کریں",
};

export const FLOW_V7_ERRORS = bilingual(FLOW_V7_ERRORS_COPY, FLOW_V7_ERRORS_COPY_UR);
export type FlowV7ErrorsCopy = typeof FLOW_V7_ERRORS_COPY;

const LONG_OK: readonly string[] = ["savedOnPhone", "noGuideLine", "recordWithoutGuide"];

export const COPY_ENTRY = { screen: "Coach · error cards (v7)", module: FLOW_V7_ERRORS as Bilingual<unknown>, same: [] as readonly string[], longOk: LONG_OK } as const;
