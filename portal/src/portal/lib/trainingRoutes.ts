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
