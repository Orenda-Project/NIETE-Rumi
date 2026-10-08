/**
 * bd-fmf24g.1 — every word of the teacher v2 frame, menu, Home, More and My profile.
 *
 * Feature folders keep their own copy.ts (teacher/<feature>/copy.ts) so parallel
 * work never collides here. Rules (DESIGN.md, Rule 20): labels are 1–4 words,
 * no sentences; data (her name, a school, a lesson title) is not copy and comes
 * from the API as is. NIETE is flat en/ur: these are the English words; the Urdu
 * pass translates this file (language-protocol skill).
 */

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
