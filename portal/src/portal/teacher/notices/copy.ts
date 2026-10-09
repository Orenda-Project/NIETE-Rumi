/**
 * bd-fmf24g.15 — the words of the notices that are SENTENCES, so they are not kit labels. (The strip's and
 * the banner's own labels — Being made, Lesson plan ready, Open, Couldn't make it — are the kit's: ui/copy.ts
 * `notify`.) Both languages from day one (language-protocol): NIETE is flat en/ur. The Urdu is MACHINE-DRAFTED
 * from COMPONENTS.md §12 "Words (in-app)" and the ontology's states, and awaits the same human review as the
 * rest (workbench/teacher-v2-impl/urdu-review/).
 *
 * "You can leave. We'll tell you here." is the operator's line for every waiting screen (9 Oct 2026). It says
 * "here" and nothing about WhatsApp: whether a message follows is the server's decision, and the line must stay
 * true with that switched off.
 */
import { bilingual, type Bilingual } from '../i18n';
import type { CopyEntry } from '../copyRegistry';

export const NOTICES_COPY = {
  /** The waiting pages (a plan being prepared, a paper being written). */
  leave: "You can leave. We'll tell you here.",
  /** Under the list that "+N more" opens. */
  listNote: "We'll tell you here when each one is ready.",
} as const;

export const NOTICES_COPY_UR = {
  leave: 'انتظار ضروری نہیں۔ تیار ہونے پر ہم یہیں بتائیں گے۔',
  listNote: 'ہر ایک تیار ہونے پر ہم یہیں بتائیں گے۔',
};

export const NOTICES = bilingual(NOTICES_COPY, NOTICES_COPY_UR);

/** Registered for the completeness checks and the review file (copyRegistry). */
export const COPY_ENTRY: CopyEntry = {
  screen: 'Notices (being made, ready, waiting pages)',
  module: NOTICES as Bilingual<unknown>,
  // The two sentences the design names.
  longOk: ['leave', 'listNote'],
};
