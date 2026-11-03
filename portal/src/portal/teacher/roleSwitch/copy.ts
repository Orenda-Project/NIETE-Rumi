/**
 * bd-tacnwy — the words of "Profile type", the internal testers' role switch (RoleSwitch.tsx), in English and Urdu.
 * Only accounts on app_settings.portal_role_switch ever see them; no real teacher or coach does.
 *
 * The three types are the ontology's people (ict-niete-ontology.md): Teacher ٹیچر, Coach کوچ, Principal ہیڈ ٹیچر.
 * "Profile type" itself is not in the ontology (it is a testers' word, not a teacher's); پروفائل follows My profile
 * (میری پروفائل). The Urdu is MACHINE-DRAFTED and waits for a native check (urdu-review.tsv, verdict NATIVE-CHECK).
 */
import { bilingual, type Bilingual, type Words } from "../i18n";
import type { CopyEntry } from "../copyRegistry";

export const ROLE_SWITCH_EN = {
  title: "Profile type",
  testers: "Testers only",
  roles: { teacher: "Teacher", coach: "Coach", principal: "Principal" },
  switchTo: (role: string) => `Switch to ${role}`,
  warning: "Finish any recording first",
  switch: "Switch",
  cancel: "Cancel",
  failed: "Not switched",
};

export const ROLE_SWITCH_UR: Words<typeof ROLE_SWITCH_EN> = {
  title: "پروفائل کی قسم",
  testers: "صرف ٹیسٹرز",
  roles: { teacher: "ٹیچر", coach: "کوچ", principal: "ہیڈ ٹیچر" },
  switchTo: (role: string) => `${role} بنیں`,
  warning: "پہلے ریکارڈنگ مکمل کریں",
  switch: "تبدیل کریں",
  cancel: "منسوخ کریں",
  failed: "تبدیل نہیں ہوا",
};

export const ROLE_SWITCH = bilingual(ROLE_SWITCH_EN, ROLE_SWITCH_UR);

export const COPY_ENTRY: CopyEntry = {
  screen: "Profile type (testers' role switch)",
  module: ROLE_SWITCH as Bilingual<unknown>,
};
