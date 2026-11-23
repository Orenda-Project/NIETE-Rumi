/**
 * bd-o15qnr.27 (queue #204) — the words v6 adds to the coach flow (#188's canvas, page v6), in English and Urdu: the Home
 * Focus card, Observe's Schedule an observation and All booked, the When? step (Schedule for Now / Schedule for Later),
 * "Observation scheduled", and the recording that keeps going while the coach moves round the app.
 *
 * Words already in the app are reused from their own files, never copied here: Booked for today, Needs you, See all N,
 * Show fewer, History, Late, Coming up (schedule/copy.ts); Waiting for you, the step chips (reports/copy.ts); Start
 * recording, Upload recording, Reschedule, Cancel visit (observe/copy.ts).
 *
 * NIETE portal v2 rule (the operator, 20 Nov, on v5: "Never use him or her. Teachers are both genders."): a teacher is
 * named, or "the teacher". v6.test.tsx holds every English value here to it.
 *
 * The Urdu is MACHINE-DRAFTED: NATIVE-CHECK (#188's words where the canvas had them).
 */
import { bilingual, type Bilingual, type Words } from '../../teacher/i18n';

/** The teacher's name, or "the teacher" when there is none: never him or her. */
const who = (name?: string | null) => (name && name.trim() ? name.trim() : 'The teacher');
const whoUr = (name?: string | null) => (name && name.trim() ? name.trim() : 'ٹیچر');

export const FLOW_V6_COPY = {
  /* Observe and the Home's empty Focus card */
  scheduleObservation: 'Schedule an observation',
  scheduleSub: 'School, teacher, then now or later',
  noVisitsToday: 'No visits booked today',
  allBooked: 'All booked',
  nMore: (n: number) => `${n} more`,
  hide: 'Hide',
  cancel: 'Cancel',

  /* the Home's Focus card, when an observation waits on the coach: the button says what the next step is */
  continueStep: {
    draft: 'Open the Feedback Form',
    talk: 'Continue the Debrief',
    report: 'Send the report',
    analysing: 'Open the observation',
    sent: 'Open the report',
  },
  moreWaiting: (n: number) => `${n} more waiting`,

  /* Schedule an observation: school search, the teacher booked today, step 3 */
  schoolSearch: 'School name',
  /** The time is already worded ("10:30 AM"). */
  bookedAt: (time: string) => `Booked ${time}`,
  when: 'When?',
  forNow: 'Schedule for Now',
  forNowSub: 'You are in the class now.',
  noMessage: (name?: string | null) => `${who(name)} gets no message.`,
  forLater: 'Schedule for Later',
  forLaterSub: (name?: string | null) => `Another time, today or another day. ${who(name)} gets a WhatsApp message.`,
  whatsappMessage: (name?: string | null) => `${who(name)} gets a WhatsApp message.`,

  /* Observation scheduled */
  observationScheduled: 'Observation scheduled',
  scheduledLine: (name?: string | null) => `${who(name)} gets a WhatsApp message. It is on Observe, under All booked.`,
  done: 'Done',
  scheduleAnother: 'Schedule another',

  /* the recording keeps going while she moves round the app (the operator, 20 Nov ~13:32) */
  keepsRecording: 'You can open other pages. The recording keeps going.',
  recordingElsewhere: 'Another observation is recording',
  backToRecording: 'Back to the recording',
} as const;

export type FlowV6Copy = Words<typeof FLOW_V6_COPY>;

// NATIVE-CHECK (bd-o15qnr.27, machine-drafted; #188's v6 canvas words where it had them)
export const FLOW_V6_COPY_UR: FlowV6Copy = {
  scheduleObservation: 'مشاہدہ شیڈول کریں',
  scheduleSub: 'اسکول، ٹیچر، پھر ابھی یا بعد میں',
  noVisitsToday: 'آج کوئی دورہ بک نہیں',
  allBooked: 'تمام بک شدہ دورے',
  nMore: (n: number) => `${n} مزید`,
  hide: 'چھپائیں',
  cancel: 'منسوخ کریں',

  continueStep: {
    draft: 'فیڈبیک فارم کھولیں',
    talk: 'ڈی بریف جاری رکھیں',
    report: 'رپورٹ بھیجیں',
    analysing: 'مشاہدہ کھولیں',
    sent: 'رپورٹ کھولیں',
  },
  moreWaiting: (n: number) => `${n} مزید منتظر`,

  schoolSearch: 'اسکول کا نام',
  bookedAt: (time: string) => `${time} پر بک`,
  when: 'کب؟',
  forNow: 'ابھی کے لیے شیڈول کریں',
  forNowSub: 'آپ ابھی کلاس میں ہیں۔',
  noMessage: (name?: string | null) => `${whoUr(name)} کو کوئی پیغام نہیں جائے گا۔`,
  forLater: 'بعد کے لیے شیڈول کریں',
  forLaterSub: (name?: string | null) => `کوئی اور وقت، آج یا کسی اور دن۔ ${whoUr(name)} کو واٹس ایپ پیغام جائے گا۔`,
  whatsappMessage: (name?: string | null) => `${whoUr(name)} کو واٹس ایپ پیغام جائے گا۔`,

  observationScheduled: 'مشاہدہ شیڈول ہو گیا',
  scheduledLine: (name?: string | null) => `${whoUr(name)} کو واٹس ایپ پیغام جائے گا۔ یہ مشاہدہ میں، تمام بک شدہ دوروں میں ہے۔`,
  done: 'ہو گیا',
  scheduleAnother: 'ایک اور شیڈول کریں',

  keepsRecording: 'آپ دوسرے صفحات کھول سکتے ہیں۔ ریکارڈنگ جاری رہے گی۔',
  recordingElsewhere: 'ایک اور مشاہدہ ریکارڈ ہو رہا ہے',
  backToRecording: 'ریکارڈنگ پر واپس جائیں',
};

export const FLOW_V6 = bilingual(FLOW_V6_COPY, FLOW_V6_COPY_UR);

/** Sentences on purpose: what reaches the teacher (or does not) is said in full, as #188's v6 boards say it. */
const LONG_OK: readonly string[] = ['forNowSub', 'noMessage', 'forLaterSub', 'whatsappMessage', 'scheduledLine', 'keepsRecording', 'scheduleSub'];

export const COPY_ENTRY = { screen: 'Coach · Observe (v6)', module: FLOW_V6 as Bilingual<unknown>, same: [] as readonly string[], longOk: LONG_OK } as const;
