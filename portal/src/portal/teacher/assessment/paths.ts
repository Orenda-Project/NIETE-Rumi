import { featurePath } from '../paths';
import type { Step } from './model';

/** bd-fmf24g.6 — where each teacher v2 Assessment page lives (all under /portal/teacher/assessment). */
export const ASSESSMENT_V2_BASE = featurePath('assessment');

const enc = encodeURIComponent;

export const newPaperPath = (step: Step) => `${ASSESSMENT_V2_BASE}/new/${step}`;
export const requestPath = (requestId: string) => `${ASSESSMENT_V2_BASE}/request/${enc(requestId)}`;
export const paperPath = (paperId: string) => `${ASSESSMENT_V2_BASE}/paper/${enc(paperId)}`;
export const versionsPath = (paperId: string) => `${paperPath(paperId)}/versions`;
export const editPath = (paperId: string) => `${paperPath(paperId)}/edit`;
/** One question (`key` is its id, or "id#sub" for a part of a comprehension). */
export const editQuestionPath = (paperId: string, key: string) => `${editPath(paperId)}/q/${enc(key)}`;
/** A new question of one catalogue type. */
export const addQuestionPath = (paperId: string, kind: string) => `${editPath(paperId)}/add/${enc(kind)}`;
