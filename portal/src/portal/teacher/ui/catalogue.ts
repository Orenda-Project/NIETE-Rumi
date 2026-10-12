/**
 * bd-fmf24g.2.2 — what each feature offers per grade. ClassPicker's other subjects fall back to these;
 * a page that reads the catalogue live passes `subjectsByGrade` instead.
 *
 * Lesson Plans: NO built-in list (bd-fmf24g.57). The one taken here on 2026-10-08 still said grade 1 =
 * English/Urdu/Math after the bot's lp_catalog.json gained General Knowledge, Social Studies and Islamiat
 * (2026-10-09), so the Lesson Plans picker hid books the WhatsApp /lp menu offered. The page passes the live
 * catalogue (lessonPlansApi.catalogue); without one, only her own classes can be picked.
 * Assessment (read on 2026-10-08; its page always passes the live /assessment/options catalogue): assessment-browse.service.js `listSubjects` — the ICT textbooks held for the grade (grades 1–5),
 * filtered by GRADE_BANDS (Science and Social Studies from grade 4, General Knowledge up to grade 3).
 */

export type SubjectsByGrade = Readonly<Record<number, readonly string[]>>;
export type TeacherCatalogueFeature = 'lessons' | 'assessment';

const fill = (from: number, to: number, subjects: readonly string[], into: Record<number, readonly string[]>) => {
  for (let g = from; g <= to; g += 1) into[g] = subjects;
  return into;
};

/** Lesson Plans holds no list: the live catalogue or nothing. */
const NO_LESSON_SUBJECTS: SubjectsByGrade = Object.freeze({});

const assessment: Record<number, readonly string[]> = {};
fill(1, 3, ['English', 'Urdu', 'Maths', 'General Knowledge', 'Islamiat'], assessment);
fill(4, 5, ['English', 'Urdu', 'Maths', 'Science', 'Social Studies', 'Islamiat'], assessment);
export const ASSESSMENT_SUBJECTS_BY_GRADE: SubjectsByGrade = assessment;

/** The map a selector or picker uses: the one given, else the feature's. */
export function subjectsByGradeFor(feature: TeacherCatalogueFeature = 'lessons', given?: SubjectsByGrade | null): SubjectsByGrade {
  if (given) return given;
  return feature === 'assessment' ? ASSESSMENT_SUBJECTS_BY_GRADE : NO_LESSON_SUBJECTS;
}
