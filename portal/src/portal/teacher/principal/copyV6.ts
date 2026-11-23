/**
 * bd-o15qnr.28 (queue #204, v6/v7 for principals) — the words the principal's Home, Observe and My observations add in
 * the coach flow's look (#188's canvas boards p9-home, p7-observe, p7-pick, p9-observations). Every other word is reused
 * from its own file (coach/flow/copy.ts, coach/schedule/copy.ts, principal/copy.ts, the frame's tile names).
 * Never him or her: the teacher's name, or "the teacher". Urdu MACHINE-DRAFTED: NATIVE-CHECK.
 */
import { bilingual, type Bilingual, type Words } from "../i18n";

export const PRINCIPAL_V6_COPY = {
  myObservations: "My observations",
  /** under Schedule an observation on her Observe page (she picks one of her teachers, or her own lesson) */
  scheduleSub: "One of my teachers, or my own lesson",
  /** line 2 of an observation row in My observations: where it is (no score: the feedback page shows the score) */
  rowStep: {
    analysing: "Analysing",
    draft: "Form to fill",
    talk: "Debrief to do",
    report: "Report to send",
    sent: "Done",
  } as Record<string, string>,
  /** the chip on a finished observation */
  done: "Done",
};

export const PRINCIPAL_V6_COPY_UR: Words<typeof PRINCIPAL_V6_COPY> = {
  myObservations: "میرے مشاہدات",
  scheduleSub: "کسی ٹیچر کا سبق، یا میرا اپنا سبق",
  rowStep: {
    analysing: "تجزیہ جاری",
    draft: "فارم بھرنا ہے",
    talk: "ڈی بریف باقی ہے",
    report: "رپورٹ بھیجنی ہے",
    sent: "مکمل",
  },
  done: "مکمل",
};

export const PRINCIPAL_V6 = bilingual(PRINCIPAL_V6_COPY, PRINCIPAL_V6_COPY_UR);

export const COPY_ENTRY = { screen: "Principal app · Home, Observe, My observations (v6/v7)", module: PRINCIPAL_V6 as Bilingual<unknown>, same: [] as readonly string[], longOk: ["scheduleSub"] as readonly string[] } as const;
