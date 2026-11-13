import { featurePath } from '../paths';

/** bd-fmf24g.8 — where the teacher v2 My Classes pages live. */
export const CLASSES_HOME = featurePath('classes');
export const CLASSES_ADD = `${CLASSES_HOME}/add`;
export const CLASS_DETAIL = `${CLASSES_HOME}/class/:classId`;
/** bd-2dn4vu — one row per child: roll no (shown) + name. */
export const CLASS_ADD_STUDENTS = `${CLASS_DETAIL}/add-students`;

export function classPath(classId: string): string {
  return `${CLASSES_HOME}/class/${encodeURIComponent(classId)}`;
}

export function addStudentsPath(classId: string): string {
  return `${classPath(classId)}/add-students`;
}
