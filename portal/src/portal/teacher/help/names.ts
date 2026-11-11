import { useCopy } from '../i18n';
import { TEACHER_FRAME } from '../copy';
import { TEACHER_BASE } from '../paths';
import { HELP } from './copy';

/** The How to use list (More → How to use). */
export const HELP_LIST_PATH = `${TEACHER_BASE}/help`;

/** A help video's name: Film 1's own, else the feature's Home tile name. */
export function useVideoName(): (feature: string) => string {
  const H = useCopy(HELP);
  const T = useCopy(TEACHER_FRAME).home.tiles as Record<string, string>;
  return (feature) => (feature === 'start' ? H.start : T[feature] ?? H.howTo);
}
