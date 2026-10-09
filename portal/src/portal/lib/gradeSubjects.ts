import api from '../services/api';

/**
 * bd-fmf24g.3 — her grade·subject pairs, for the picker every teacher v2 feature opens with
 * (Lesson Plans, Digital Coaching, Assessment, Attendance): GET /api/portal/me/grade-subjects.
 *
 * Her CLASSES first (source 'class'); only when they give no pair, her HISTORY (source 'history':
 * lesson plans she used, DC lessons, papers she made). One subject key whatever the source spelled
 * (dashboard subject-vocabulary.service), the name already in her language.
 *
 * With a feature, each pair also carries that catalogue's own key (`featureKey` — what the
 * feature's own API wants back) and whether the catalogue has the subject for that grade at all
 * (`available`). The picker shows her classes either way; a pair that is not available is drawn
 * as such rather than hidden, so she is never told she has no classes.
 *
 * A failed read THROWS (the server's 502): "no classes" is not an answer we know.
 */

export type GradeSubjectFeature = 'lessons' | 'assessment';

export type GradeSubject = {
  /** 1–12; null for early years (no lesson plan or paper has one). */
  grade: number | null;
  gradeCode: string;
  /** Her word for it (preferred_language). */
  subject: string;
  /** One key per subject across every source: maths, science, physics, pakistan_studies… */
  subjectKey: string;
  source: 'class' | 'history';
  /** With a feature: that catalogue's key for this subject in this grade, or null. */
  featureKey?: string | null;
  available?: boolean;
};

type Row = Record<string, unknown>;

function pair(r: Row | null): GradeSubject | null {
  if (!r || typeof r !== 'object') return null;
  const subjectKey = typeof r.subjectKey === 'string' && r.subjectKey ? r.subjectKey : null;
  const gradeCode = typeof r.gradeCode === 'string' && r.gradeCode ? r.gradeCode : null;
  if (!subjectKey || !gradeCode) return null;
  const grade = typeof r.grade === 'number' && Number.isInteger(r.grade) ? r.grade : null;
  const out: GradeSubject = {
    grade,
    gradeCode,
    subject: typeof r.subject === 'string' && r.subject ? r.subject : subjectKey,
    subjectKey,
    source: r.source === 'history' ? 'history' : 'class',
  };
  if ('featureKey' in r) {
    out.featureKey = typeof r.featureKey === 'string' && r.featureKey ? r.featureKey : null;
    out.available = r.available === true && out.featureKey !== null;
  }
  return out;
}

export async function loadGradeSubjects(feature?: GradeSubjectFeature): Promise<GradeSubject[]> {
  const { data } = await api.get('/me/grade-subjects', feature ? { params: { feature } } : undefined);
  if (!data || data.success !== true || !Array.isArray(data.combos)) {
    throw new Error('grade-subjects: unexpected answer');
  }
  return (data.combos as Row[]).map(pair).filter((p): p is GradeSubject => p !== null);
}
