/**
 * bd-fmf24g.1 — every word of the teacher v2 frame, menu, Home, More and My profile.
 *
 * Feature folders keep their own copy.ts (teacher/<feature>/copy.ts) so parallel
 * work never collides here. Rules (DESIGN.md, Rule 20): labels are 1–4 words,
 * no sentences; data (her name, a school, a lesson title) is not copy and comes
 * from the API as is. NIETE is flat en/ur (language-protocol skill).
 *
 * bd-fmf24g.13 — bilingual: TEACHER_FRAME = { en, ur }, read with useCopy(TEACHER_FRAME). The Urdu is
 * MACHINE-DRAFTED from the bot's existing Urdu (ux-strings.js menu rows: لیسن پلان, حاضری, میری کلاسیں…)
 * and awaits a human review (workbench/teacher-v2-impl/urdu-review/).
 */
import { bilingual, type Bilingual } from "./i18n";
import type { CopyEntry } from "./copyRegistry";

export const TEACHER_COPY = {
  back: "Back",
  menu: "Menu",
  brand: "NIETE",
  logoAlt: "NIETE logo",
  tryAgain: "Try again",
  nav: {
    home: "Home",
    lessons: "Lessons",
    coaching: "Digital Coaching",
    training: "Training",
    more: "More",
  },
  home: {
    /** "Salaam, Ayesha Bibi!" — her whole name (operator, 2026-10-08). */
    greeting: (name: string) => (name ? `Salaam, ${name}!` : "Salaam!"),
    features: "Features",
    tiles: {
      lessons: "Lesson Plans",
      coaching: "Digital Coaching",
      observations: "Observations",
      training: "Training",
      assessment: "Assessment",
      attendance: "Attendance",
      classes: "My Classes",
    },
  },
  more: {
    title: "More",
    teaching: "Teaching",
    records: "Training records",
    account: "Account",
    assessment: "Assessment",
    attendance: "Attendance",
    classes: "My Classes",
    analytics: "Analytics",
    certificates: "Certificates",
    language: "Language",
    profile: "My profile",
    logout: "Logout",
    /** The Language row names the language it switches TO, in that language's own script. */
    switchTo: { ur: "اردو", en: "English" },
    notSaved: "Not saved",
  },
  profile: {
    title: "My profile",
    crumb: "More",
    name: "Name",
    phone: "Phone",
    school: "School",
    level: "Teaching level",
    save: "Save",
    saved: "Saved",
    notSaved: "Not saved",
    /** "Locked · 31h" — the server's 48-hour rule (band-selection.service). */
    lockedFor: (hours: number) => `Locked · ${hours}h`,
    locked: "Locked",
    lockedAfterSave: "Locked 48h after save",
  },
} as const;

/** bd-fmf24g.13 — the frame's words in Urdu (MACHINE-DRAFTED; review pending). */
export const TEACHER_COPY_UR = {
  back: "واپس",
  menu: "مینو",
  brand: "NIETE",
  logoAlt: "NIETE لوگو",
  tryAgain: "دوبارہ کوشش کریں",
  nav: {
    home: "ہوم",
    lessons: "لیسن پلان",
    coaching: "ڈیجیٹل کوچنگ",
    training: "ٹریننگ",
    more: "مزید",
  },
  home: {
    greeting: (name: string) => (name ? `السلام علیکم، ${name}!` : "السلام علیکم!"),
    features: "سہولیات",
    tiles: {
      lessons: "لیسن پلان",
      coaching: "ڈیجیٹل کوچنگ",
      observations: "مشاہدات",
      training: "ٹریننگ",
      assessment: "پرچہ",
      attendance: "حاضری",
      classes: "میری کلاسیں",
    },
  },
  more: {
    title: "مزید",
    teaching: "تدریس",
    records: "ٹریننگ ریکارڈ",
    account: "اکاؤنٹ",
    assessment: "پرچہ",
    attendance: "حاضری",
    classes: "میری کلاسیں",
    analytics: "تجزیہ",
    certificates: "سرٹیفکیٹ",
    language: "زبان",
    profile: "میری پروفائل",
    logout: "لاگ آؤٹ",
    switchTo: { ur: "اردو", en: "English" },
    notSaved: "محفوظ نہیں ہوا",
  },
  profile: {
    title: "میری پروفائل",
    crumb: "مزید",
    name: "نام",
    phone: "فون",
    school: "اسکول",
    level: "تدریسی سطح",
    save: "محفوظ کریں",
    saved: "محفوظ ہو گیا",
    notSaved: "محفوظ نہیں ہوا",
    lockedFor: (hours: number) => `بند · ${hours} گھنٹے`,
    locked: "بند",
    lockedAfterSave: "48 گھنٹے تک بند",
  },
};

/** The frame's words in both languages. */
export const TEACHER_FRAME = bilingual(TEACHER_COPY, TEACHER_COPY_UR);

/** Registered for the completeness checks and the review file (copyRegistry). */
export const COPY_ENTRY: CopyEntry = {
  screen: "frame (menu, Home, More, My profile)",
  module: TEACHER_FRAME as Bilingual<unknown>,
  // The brand, and the Language row's names, each written in its own script in both languages.
  same: ["brand", "more.switchTo.ur", "more.switchTo.en"],
  // "Salaam, Ayesha!" — a greeting, with its "!" as in English.
  longOk: ["home.greeting"],
};
