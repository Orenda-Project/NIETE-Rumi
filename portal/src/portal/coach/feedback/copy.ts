/**
 * bd-x1tl95 — the words of Send feedback (the coach's More), in English and Urdu. The vocabulary's words where it has one
 * (ict-niete-ontology): Voice note (never "voice message"), Next «آگے بڑھیں», Send «بھیجیں», Remove «ہٹائیں», Stop
 * «ختم کریں», More «مزید»; prompts are nouns, never questions. "Send feedback" is not in the vocabulary yet and «رائے» is
 * new to the app: both PENDING the operator (decisions-2026-10-30). The Urdu is MACHINE-DRAFTED and waits for a native
 * check (urdu-review.tsv, verdict NATIVE-CHECK).
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";
import type { CopyEntry } from "../../teacher/copyRegistry";

export const FEEDBACK_EN = {
  title: "Send feedback",
  topic: "Topic",
  // The four kinds of Report an issue (bd-whlsm0), folded into this form; the bot's TOPICS, same order.
  broken: "Something isn’t working",
  numbers: "Numbers look wrong",
  idea: "An idea",
  other: "Something else",
  yourFeedback: "Your feedback",
  record: "Record a voice note",
  recording: "Recording",
  stop: "Stop",
  voiceNote: "Your voice note",
  removeVoice: "Remove voice note",
  orWrite: "Or write here",
  screenshots: "Screenshots",
  optional: "Optional, up to three",
  addScreenshot: "Add screenshot",
  removeScreenshot: "Remove screenshot",
  next: "Next",
  send: "Send",
  sending: "Sending",
  thanks: "Thank you",
  gotIt: "We got your feedback.",
  done: "Done",
  couldNotSend: "Couldn’t send. Try again.",
  noInternet: "No internet",
  tooMany: "That’s today’s limit. Try again tomorrow.",
  micBlocked: "Microphone blocked",
  micHint: "Allow the microphone for WhatsApp in your phone’s settings, or write instead.",
  notPicture: "Only a picture: JPG or PNG",
  tooLarge: "That picture is too large",
  audio: { play: "Play", pause: "Pause", cantPlay: "Can’t play" },
};

export const FEEDBACK_UR: Words<typeof FEEDBACK_EN> = {
  title: "رائے بھیجیں",
  topic: "موضوع",
  broken: "کچھ کام نہیں کر رہا",
  numbers: "اعداد غلط ہیں",
  idea: "ایک تجویز",
  other: "کچھ اور",
  yourFeedback: "آپ کی رائے",
  record: "وائس نوٹ ریکارڈ کریں",
  recording: "ریکارڈنگ",
  stop: "ختم کریں",
  voiceNote: "آپ کا وائس نوٹ",
  removeVoice: "وائس نوٹ ہٹائیں",
  orWrite: "یا یہاں لکھیں",
  screenshots: "اسکرین شاٹس",
  optional: "اختیاری، زیادہ سے زیادہ تین",
  addScreenshot: "اسکرین شاٹ شامل کریں",
  removeScreenshot: "اسکرین شاٹ ہٹائیں",
  next: "آگے بڑھیں",
  send: "بھیجیں",
  sending: "بھیجا جا رہا ہے",
  thanks: "شکریہ",
  gotIt: "ہمیں آپ کی رائے مل گئی۔",
  done: "ٹھیک ہے",
  couldNotSend: "نہیں بھیجا جا سکا۔ دوبارہ کوشش کریں۔",
  noInternet: "انٹرنیٹ نہیں ہے",
  tooMany: "آج کی حد پوری ہو گئی۔ کل دوبارہ کوشش کریں۔",
  micBlocked: "مائیک کی اجازت نہیں",
  micHint: "فون کی سیٹنگز میں WhatsApp کو مائیک کی اجازت دیں، یا لکھ کر بھیجیں۔",
  notPicture: "صرف تصویر: JPG یا PNG",
  tooLarge: "یہ تصویر بہت بڑی ہے",
  audio: { play: "چلائیں", pause: "روکیں", cantPlay: "نہیں چل سکا" },
};

export const FEEDBACK = bilingual(FEEDBACK_EN, FEEDBACK_UR);
export type FeedbackCopy = typeof FEEDBACK_EN;

export const COPY_ENTRY: CopyEntry = {
  screen: "Coach Send feedback",
  module: FEEDBACK as Bilingual<unknown>,
  longOk: ["broken", "optional", "gotIt", "couldNotSend", "tooMany", "micHint", "notPicture", "tooLarge", "removeVoice", "removeScreenshot", "addScreenshot", "record"],
};
