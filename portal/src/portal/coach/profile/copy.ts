/**
 * bd-4404s7.2 — the words of the coach's More and My profile pages, in English and Urdu. Labels only.
 * Her name, phone and the counts are data. The words she shares with the teacher's frame (More, My profile,
 * Certificates, Language, Log out, Name, Phone, Training) are the frame's (teacher/copy.ts), never repeated here.
 * The Urdu is MACHINE-DRAFTED and waits for a native check (urdu-review.tsv, verdict NATIVE-CHECK).
 */
import { bilingual, type Bilingual, type Words } from "../../teacher/i18n";
import type { CopyEntry } from "../../teacher/copyRegistry";

export const COACH_PROFILE_EN = {
  schools: "Schools",
  schoolsN: (n: number) => (n === 1 ? "1 school" : `${n} schools`),
  teachersN: (n: number) => `${n} teachers`,
  childTest: "Child test",
  assess: "Learning assessment",
  account: "Account",
  privacy: "Privacy policy",
  deleteAccount: "Delete account",
  // bd-whlsm0: More → Report an issue (the row and the page's title), its two questions and what it says after Send.
  report: "Report an issue",
  reportKind: "Kind of issue",
  kinds: { broken: "Something isn't working", numbers: "Numbers look wrong", idea: "An idea", other: "Something else" },
  reportMessage: "Your message",
  send: "Send",
  sent: "Sent",
  thanks: "Thank you",
  notSent: "Not sent",
};

export const COACH_PROFILE_UR: Words<typeof COACH_PROFILE_EN> = {
  schools: "اسکول",
  schoolsN: (n: number) => (n === 1 ? "1 اسکول" : `${n} اسکول`),
  teachersN: (n: number) => `${n} ٹیچرز`,
  childTest: "بچے کا ٹیسٹ",
  assess: "تعلیمی جائزہ",
  account: "اکاؤنٹ",
  privacy: "پرائیویسی پالیسی",
  deleteAccount: "اکاؤنٹ حذف کریں",
  report: "مسئلہ بتائیں",
  reportKind: "مسئلے کی قسم",
  kinds: { broken: "کچھ خراب ہے", numbers: "اعداد غلط ہیں", idea: "ایک تجویز", other: "کچھ اور" },
  reportMessage: "آپ کا پیغام",
  send: "بھیجیں",
  sent: "بھیجا گیا",
  thanks: "شکریہ",
  notSent: "نہیں بھیجا گیا",
};

export const COACH_PROFILE = bilingual(COACH_PROFILE_EN, COACH_PROFILE_UR);

export const COPY_ENTRY: CopyEntry = {
  screen: "Coach More and My profile",
  module: COACH_PROFILE as Bilingual<unknown>,
};
