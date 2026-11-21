/**
 * bd-o15qnr.28 (queue #204, v7) — the words v7 adds (#188's canvas page v7, LOCK round): the status line (option A),
 * the debrief's due day, the visit's step cards, the one feedback page (coach "Your debrief report", principal "Your
 * feedback"). Words already in the app are reused from their own files (report/copy.ts, reports/copy.ts, observe/copy.ts).
 * Never him or her: the teacher's name, or "the teacher". Urdu MACHINE-DRAFTED: NATIVE-CHECK.
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";

export const FLOW_V7_COPY = {
  /* the status line: [done, current, later] for each of the four steps */
  steps: [
    { done: "Analysed", current: "Analysing", later: "To analyse" },
    { done: "Form filled", current: "Fill the form", later: "Form to fill" },
    { done: "Debriefed", current: "Record the debrief", later: "Debrief to do" },
    { done: "Sent", current: "Send the report", later: "Yet to send" },
  ],
  now: (step: string) => `Now: ${step}`,
  allDone: "Done",

  /* the debrief's due day (3 school days after the visit) */
  dueBy: (day: string) => `Due by ${day}`,
  wasDue: (day: string) => `Was due ${day}`,

  /* the visit's step cards */
  yourDebrief: "Your debrief",
  talkThenRecord: "Talk with the teacher, then record it here.",
  fillTheForm: "Fill the Feedback Form",
  sendTitle: (name: string) => `Send ${name} the report`,
  getsOnWhatsApp: (name: string) => `${name} gets it on WhatsApp.`,
  sendReport: "Send report",

  /* the one feedback page */
  behavioursSeen: "behaviours seen",
  keyFocus: "Key Focus Area",
  yourBehaviours: (n: number) => `Your ${n} behaviours`,
  respectHeld: "Respect held",
  respectNote: "a must every time; not one of the 8",
  required: "required",
  showMore: (n: number) => `Show ${n} more`,
  showFewer: "Show fewer",
  principalTitle: "Your feedback",
  principalFoot: "The choice is yours.",
  observations: "Observations",

  /* the visit while the Digital Coach works */
  listening: "Rumi is listening to the lesson",
  listeningSub: "Usually a few minutes. This page updates by itself; you can leave.",

  /* Check and send: the class question as chips (grades 6–12 pick the form) */
} as const;

export type FlowV7Copy = Words<typeof FLOW_V7_COPY>;

// NATIVE-CHECK (bd-o15qnr.28, machine-drafted; #188's v7 canvas words where it had them)
export const FLOW_V7_COPY_UR: FlowV7Copy = {
  steps: [
    { done: "تجزیہ ہو گیا", current: "تجزیہ جاری", later: "تجزیہ باقی" },
    { done: "فارم بھر دیا", current: "فارم بھریں", later: "فارم باقی" },
    { done: "ڈی بریف ہو گیا", current: "ڈی بریف ریکارڈ کریں", later: "ڈی بریف باقی" },
    { done: "بھیج دی", current: "رپورٹ بھیجیں", later: "ابھی نہیں بھیجی" },
  ],
  now: (step: string) => `ابھی: ${step}`,
  allDone: "مکمل",

  dueBy: (day: string) => `${day} تک`,
  wasDue: (day: string) => `${day} تک تھا`,

  yourDebrief: "آپ کا ڈی بریف",
  talkThenRecord: "ٹیچر سے بات کریں، پھر یہاں ریکارڈ کریں۔",
  fillTheForm: "فیڈبیک فارم بھریں",
  sendTitle: (name: string) => `${name} کو رپورٹ بھیجیں`,
  getsOnWhatsApp: (name: string) => `${name} کو یہ واٹس ایپ پر ملے گی۔`,
  sendReport: "رپورٹ بھیجیں",

  behavioursSeen: "رویے نظر آئے",
  keyFocus: "اہم توجہ",
  yourBehaviours: (n: number) => `آپ کے ${n} رویے`,
  respectHeld: "احترام قائم رہا",
  respectNote: "ہر بار لازمی؛ ۸ میں سے ایک نہیں",
  required: "لازمی",
  showMore: (n: number) => `${n} مزید دکھائیں`,
  showFewer: "کم دکھائیں",
  principalTitle: "آپ کا فیڈبیک",
  principalFoot: "فیصلہ آپ کا ہے۔",
  observations: "مشاہدات",

  listening: "رومی سبق سن رہا ہے",
  listeningSub: "عموماً چند منٹ۔ یہ صفحہ خود بدل جاتا ہے؛ آپ جا سکتے ہیں۔",

};

export const FLOW_V7 = bilingual(FLOW_V7_COPY, FLOW_V7_COPY_UR);

const LONG_OK: readonly string[] = ["talkThenRecord", "getsOnWhatsApp", "principalFoot", "listening", "listeningSub", "respectNote"];

export const COPY_ENTRY = { screen: "Coach · visit and feedback (v7)", module: FLOW_V7 as Bilingual<unknown>, same: [] as readonly string[], longOk: LONG_OK } as const;
