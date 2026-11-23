/**
 * bd-o15qnr.33 (queue #204, v7) — the words of Check and send's one "Attach lesson plan" step (the operator, 21 Nov ~09:10:
 * "It should be Attach Lesson Plan. Then 2 buttons, nietes lp or attach teachers lp. You can figure out the copy here").
 * Words already in the app are reused from their own files (observe/copy.ts: Optional, Camera, Remove plan, Grade N,
 * Grade 1-5, the subject names; the kit's Change). The vocabulary is the ontology's: Lesson plan = لیسن پلان, Chapter = باب,
 * Recent Lesson Plans = حالیہ لیسن پلان. NIETE stays Latin in Urdu, isolated (as the bot's «NIETE ٹیچنگ اسسٹنٹ»).
 * Never him or her: "the teacher". Urdu MACHINE-DRAFTED: NATIVE-CHECK.
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";

export const PLAN_V7_COPY = {
  /* the section's heading (the operator's own words) */
  attachPlan: "Attach lesson plan",
  /* the two choices */
  nietePlan: "NIETE lesson plan",
  ownPlan: "Teacher’s own plan",
  /* the NIETE lesson plan tray */
  recentPlans: "Recent lesson plans",
  noneForClass: "None for this class",
  pickChapter: "Pick a chapter",
  /* the Teacher's own plan tray (beside observe/copy's Camera) */
  attachFile: "Attach file",
};

// NATIVE-CHECK (bd-o15qnr.33, machine-drafted)
export const PLAN_V7_COPY_UR: Words<typeof PLAN_V7_COPY> = {
  attachPlan: "لیسن پلان لگائیں",
  nietePlan: "⁦NIETE⁩ لیسن پلان",
  ownPlan: "ٹیچر کا اپنا پلان",
  recentPlans: "حالیہ لیسن پلان",
  noneForClass: "اس کلاس کا کوئی پلان نہیں",
  pickChapter: "باب چنیں",
  attachFile: "فائل لگائیں",
};

export const PLAN_V7 = bilingual(PLAN_V7_COPY, PLAN_V7_COPY_UR);
export type PlanV7Copy = typeof PLAN_V7_COPY;

// The empty tray line: Urdu needs six words for the English four ("this class" + "no plan").
const LONG_OK: readonly string[] = ["noneForClass"];

export const COPY_ENTRY = { screen: "Coach · Check and send, Attach lesson plan (v7)", module: PLAN_V7 as Bilingual<unknown>, same: [] as readonly string[], longOk: LONG_OK } as const;
