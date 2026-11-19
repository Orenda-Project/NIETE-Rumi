import { JOURNEY_PATH } from '../../journey/paths';

/**
 * My journey (portal_teacher_journey): the teacher's own steps, newest first. Home's My journey row opens the page;
 * Home's "Taught in class" tile opens it filtered to the taught lines of the same 30 days (`?step=taught`).
 */
export const TEACHER_JOURNEY = JOURNEY_PATH;

export function journeyHref(step?: 'taught'): string {
  return step ? `${TEACHER_JOURNEY}?step=${step}` : TEACHER_JOURNEY;
}
