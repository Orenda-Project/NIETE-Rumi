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
  nav: {
    home: "Home",
    lessons: "Lessons",
    coaching: "Digital Coaching",
    training: "Training",
    more: "More",
  },
} as const;
