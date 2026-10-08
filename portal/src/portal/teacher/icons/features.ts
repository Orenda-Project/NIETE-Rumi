/** bd-fmf24g.2.1 — the teacher app's features and their hues (v28 canvas, Main.dc.html `.f-*`). */

export type TeacherFeature = 'lessons' | 'coaching' | 'observations' | 'training' | 'assessment' | 'attendance' | 'classes';

/** Home's order. */
export const TEACHER_FEATURES: readonly TeacherFeature[] = [
  'lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance', 'classes',
];

/** Each feature's hue on its light tint (Main.dc.html `.f-*`): the ONLY place a feature colour is used. */
export const FEATURE_HUE: Record<TeacherFeature, { fg: string; bg: string }> = {
  lessons: { fg: '#2f7a52', bg: '#eaf6ef' },
  coaching: { fg: '#c2410c', bg: '#ffedd5' },
  observations: { fg: '#c8331f', bg: '#fee4e2' },
  training: { fg: '#6e52e0', bg: '#eeeafd' },
  assessment: { fg: '#1d6fd8', bg: '#e3eefc' },
  attendance: { fg: '#33374a', bg: '#e8e9f0' },
  classes: { fg: '#0f766e', bg: '#ccfbf1' },
};
