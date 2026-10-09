import { COACHING_COPY } from '../copy';

/**
 * bd-fmf24g.13 — the words the lesson-plan picker reads (PlanSheet, LibraryStep, planChips), widened so a
 * translation can stand in for them: the teacher v2's Digital Coaching passes its own, in the page's language
 * (teacher/coaching/copy.ts, `picker`). Left out, the picker reads COACHING_COPY's English, as before.
 */
export type PickerWords = {
  readonly lessonPlan: string;
  readonly recent: string;
  readonly planFallback: string;
  readonly fromLibrary: string;
  readonly takePhoto: string;
  readonly chooseFile: string;
  readonly notAPlan: string;
  readonly steps: { readonly grade: string; readonly subject: string; readonly chapter: string; readonly lesson: string };
  readonly grade: (n: number | string) => string;
  readonly used: string;
  readonly notWritten: string;
  readonly preparing: string;
  readonly failed: string;
  readonly nothingHere: string;
  readonly notLoaded: string;
  readonly retry: string;
  readonly loading: string;
};

/** COACHING_COPY's English for the picker, word for word. */
export const PICKER_WORDS_EN: PickerWords = {
  lessonPlan: COACHING_COPY.lessonPlan,
  recent: COACHING_COPY.recent,
  planFallback: COACHING_COPY.planFallback,
  fromLibrary: COACHING_COPY.fromLibrary,
  takePhoto: COACHING_COPY.takePhoto,
  chooseFile: COACHING_COPY.chooseFile,
  notAPlan: COACHING_COPY.notAPlan,
  steps: COACHING_COPY.steps,
  grade: COACHING_COPY.grade,
  used: COACHING_COPY.used,
  notWritten: COACHING_COPY.notWritten,
  preparing: COACHING_COPY.preparing,
  failed: COACHING_COPY.failed,
  nothingHere: COACHING_COPY.nothingHere,
  notLoaded: COACHING_COPY.notLoaded,
  retry: COACHING_COPY.retry,
  loading: COACHING_COPY.loading,
};
