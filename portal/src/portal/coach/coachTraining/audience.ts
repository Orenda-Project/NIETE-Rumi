import type { CoachModule } from "./modules";

/**
 * bd-v04lsh (queue #257) — who the Coach Training pages are drawn for. The operator, 24 Nov 2026: "Coach Trainings needs
 * to go live for Principal as well. Showing as Principal Training. Same feature, same trainings." So a principal gets the
 * same ten modules (modules.ts, never a copy), the same PDF / Video choice and the same Mark done (her own row), under
 * the name Principal Training, at her own address in the teacher app (teacher/principal/training.tsx).
 *
 *   coach      /portal/coach/coach-training(/<n>)            "Coach Training"
 *   principal  /portal/teacher/principal-training(/<n>)      "Principal Training"
 */
export type TrainingAudience = "coach" | "principal";

/**
 * modules.ts COACH_TRAINING_PATH, written out: the principal routes (in the teacher route registry, the first chunk)
 * import this file, and a type-only import keeps the module list out of that chunk. PrincipalTraining.test pins the two.
 */
const COACH_LIST = "/portal/coach/coach-training";

export const PRINCIPAL_TRAINING_PATH = "/portal/teacher/principal-training";
export const PRINCIPAL_MODULE_PATH = `${PRINCIPAL_TRAINING_PATH}/:n`;

export const trainingListPath = (a: TrainingAudience): string => (a === "principal" ? PRINCIPAL_TRAINING_PATH : COACH_LIST);
export const trainingModulePath = (a: TrainingAudience, m: CoachModule): string => `${trainingListPath(a)}/${m.n}`;
