import { useCopy } from '../i18n';
import { TEACHER_UI, type TeacherUiCopy } from './copy';

/**
 * bd-fmf24g.13 — the kit's default words in the page's language. Every kit component starts from these and
 * lays a screen's `copy` prop over them (`{ ...useKitCopy(), ...copy }`), so a screen's word always wins.
 */
export function useKitCopy(): TeacherUiCopy {
  return useCopy(TEACHER_UI) as TeacherUiCopy;
}
