/**
 * bd-fmf24g.2.2 — what each feature offers per grade: the subjects the WhatsApp bot offers today, read on
 * 2026-10-08 (COMPONENTS.md §4 has the sources). ClassPicker's other subjects fall back to these;
 * a page that reads the catalogue live passes `subjectsByGrade` instead.
 *
 * Lesson Plans: grades 1–5 = the books in bot/data/lp_catalog.json; 6–12 = distinct `subject` per grade in
 * niete_lp612_segments where is_current, ordered as lp612-browse.service.js `listSubjects` (core before elective).
 * Islamiat 6–11 shows only when LP_612_RELIGIOUS_ENABLED is on (every Islamiat segment is is_religious), so it is
 * not in the default map.
 * Assessment: assessment-browse.service.js `listSubjects` — the ICT textbooks held for the grade (grades 1–5),
 * filtered by GRADE_BANDS (Science and Social Studies from grade 4, General Knowledge up to grade 3).
 */

export type SubjectsByGrade = Readonly<Record<number, readonly string[]>>;
export type TeacherCatalogueFeature = 'lessons' | 'assessment';

const fill = (from: number, to: number, subjects: readonly string[], into: Record<number, readonly string[]>) => {
  for (let g = from; g <= to; g += 1) into[g] = subjects;
  return into;
};

const lessons: Record<number, readonly string[]> = {};
fill(1, 3, ['English', 'Urdu', 'Math'], lessons);
fill(4, 5, ['English', 'Urdu', 'Math', 'General Science'], lessons);
fill(6, 7, ['English', 'Urdu', 'Mathematics', 'General Science', 'Computer Science', 'Agricultural Education (Zarai Taleem)', 'Geography', 'History'], lessons);
lessons[8] = ['English', 'Urdu', 'Mathematics', 'General Science', 'Computer Science', 'Geography', 'History'];
fill(9, 10, ['English', 'Urdu', 'Mathematics', 'Pakistan Studies', 'Physics', 'Chemistry', 'Biology', 'Computer Science'], lessons);
lessons[11] = ['English', 'Urdu', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science'];
lessons[12] = ['English', 'Urdu', 'Mathematics', 'Pakistan Studies', 'Physics', 'Chemistry', 'Biology', 'Computer Science'];
export const LESSON_SUBJECTS_BY_GRADE: SubjectsByGrade = lessons;

const assessment: Record<number, readonly string[]> = {};
fill(1, 3, ['English', 'Urdu', 'Maths', 'General Knowledge', 'Islamiat'], assessment);
fill(4, 5, ['English', 'Urdu', 'Maths', 'Science', 'Social Studies', 'Islamiat'], assessment);
export const ASSESSMENT_SUBJECTS_BY_GRADE: SubjectsByGrade = assessment;

/** The map a selector or picker uses: the one given, else the feature's. */
export function subjectsByGradeFor(feature: TeacherCatalogueFeature = 'lessons', given?: SubjectsByGrade | null): SubjectsByGrade {
  if (given) return given;
  return feature === 'assessment' ? ASSESSMENT_SUBJECTS_BY_GRADE : LESSON_SUBJECTS_BY_GRADE;
}
