/**
 * bd-5rz1v.13 — Assessment's own pages (new UI only). App.tsx mounts exactly this list, and the
 * page test mounts it too, so a page the screens navigate to cannot go unserved.
 *
 *   home     /portal/assessment                      — make one (the menu's Assessment item)
 *   request  /portal/assessment/request/:requestId   — writing, then ready (or not made)
 *   mine     /portal/assessment/mine                 — everything she has made
 */
export const ASSESSMENT_PATH = '/portal/assessment';

export type AssessmentView = 'home' | 'request' | 'mine';

export const ASSESSMENT_ROUTES: ReadonlyArray<{ path: string; view: AssessmentView }> = [
  { path: ASSESSMENT_PATH, view: 'home' },
  { path: `${ASSESSMENT_PATH}/request/:requestId`, view: 'request' },
  { path: `${ASSESSMENT_PATH}/mine`, view: 'mine' },
];
