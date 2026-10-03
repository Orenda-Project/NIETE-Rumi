/**
 * bd-klecr — every training route, under both bases.
 *
 * /portal/training is what the nav points at; /portal/training/v2 is the review
 * URL that was handed out and is kept alive (bd-60160). App.tsx mounts exactly
 * this list, and the page tests mount it too, so a URL the page navigates to
 * that the app does not serve fails in a test rather than as a blank page.
 *
 * The course page's param is `browseCourseId`, not `courseId`: `courseId` is
 * the EXAM route's, and the page reads its presence as "an exam is open".
 */
export const TRAINING_V2_PATHS: string[] = ['/portal/training', '/portal/training/v2'].flatMap(base => [
  base,
  `${base}/certificates`,
  `${base}/provider/:vendorKey`,
  `${base}/provider/:vendorKey/level/:levelId`,
  `${base}/provider/:vendorKey/level/:levelId/course/:browseCourseId`,
  `${base}/unit/:moduleId`,
  `${base}/exam/:courseId`,
]);

/**
 * bd-5rz1v.25 — the same addresses, each named for the screen it shows, plus the addresses only
 * the new UI has (My grades, the level exam page). App.tsx mounts exactly this list through
 * PortalTrainingPage, which picks the new screen (flag on, a teacher) or PortalTrainingV2.
 *
 * With the flag off a new-only address goes to the old page it stands for (NEW_ONLY_FALLBACK),
 * so a link handed out from the new UI never dead-ends.
 */
export type TrainingView =
  | 'home' | 'certificates' | 'grades' | 'provider' | 'level' | 'levelExam' | 'course' | 'unit' | 'exam';

const VIEWS: ReadonlyArray<[suffix: string, view: TrainingView]> = [
  ['', 'home'],
  ['/certificates', 'certificates'],
  ['/grades', 'grades'],
  ['/provider/:vendorKey', 'provider'],
  ['/provider/:vendorKey/level/:levelId', 'level'],
  ['/provider/:vendorKey/level/:levelId/exam', 'levelExam'],
  ['/provider/:vendorKey/level/:levelId/course/:browseCourseId', 'course'],
  ['/unit/:moduleId', 'unit'],
  ['/exam/:courseId', 'exam'],
];

export const TRAINING_ROUTES: ReadonlyArray<{ path: string; view: TrainingView }> = ['/portal/training', '/portal/training/v2']
  .flatMap(base => VIEWS.map(([suffix, view]) => ({ path: `${base}${suffix}`, view })));

/** Where a new-only address goes with the flag off: the old page it stands for. */
export function newOnlyFallback(view: TrainingView, pathname: string): string | null {
  if (view === 'grades') return pathname.replace(/\/grades\/?$/, '');
  if (view === 'levelExam') return pathname.replace(/\/exam\/?$/, '');
  return null;
}
