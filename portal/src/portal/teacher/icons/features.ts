/** bd-fmf24g.2.1 — the teacher app's features and their hues (v28 canvas, Main.dc.html `.f-*`). */

export type TeacherFeature = 'lessons' | 'coaching' | 'observations' | 'training' | 'assessment' | 'attendance' | 'classes';

/** bd-4404s7.1 — the features only a coach has: Schedule (rose), Schools & teachers (teal), Reports (olive; the Observe screen's tile and the Reports headers). */
export type CoachFeature = 'schedule' | 'schools' | 'reports';

/** Every feature the art, the glyphs and the hues cover. A teacher page uses `TeacherFeature`; a coach page may use any. */
export type AnyFeature = TeacherFeature | CoachFeature;

/** Home's order. */
export const TEACHER_FEATURES: readonly TeacherFeature[] = [
  'lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance', 'classes',
];

/** The coach's Home tiles, in order (Coach_Home): Schedule, Observe, Schools & teachers, Training. */
export const COACH_FEATURES: readonly AnyFeature[] = ['schedule', 'observations', 'schools', 'training'];

/** Each feature's hue on its light tint (Main.dc.html `.f-*`): the ONLY place a feature colour is used. */
export const FEATURE_HUE: Record<AnyFeature, { fg: string; bg: string }> = {
  lessons: { fg: '#2f7a52', bg: '#eaf6ef' },
  coaching: { fg: '#c2410c', bg: '#ffedd5' },
  observations: { fg: '#c8331f', bg: '#fee4e2' },
  training: { fg: '#6e52e0', bg: '#eeeafd' },
  assessment: { fg: '#1d6fd8', bg: '#e3eefc' },
  attendance: { fg: '#33374a', bg: '#e8e9f0' },
  classes: { fg: '#0f766e', bg: '#ccfbf1' },
  // bd-4404s7.1 — Coach_TileOptions B (chosen 2026-10-09): each its own hue, one colour one meaning.
  schedule: { fg: '#be185d', bg: '#fce7f3' },
  schools: { fg: '#0f766e', bg: '#ccfbf1' },
  // ReportsIcon board: its own illustration, not Assessment's.
  reports: { fg: '#4d7c0f', bg: '#ecfccb' },
};
