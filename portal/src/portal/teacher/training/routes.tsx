import type { TeacherRoute } from '../routes';
import { CertificatesPage } from './CertificatesPage';
import { CoursePage } from './CoursePage';
import { GradesPage } from './GradesPage';
import { LevelExamPage } from './LevelExamPage';
import { TRAINING_V2_BASE as B } from './model';
import { ModuleExamPage } from './ModuleExamPage';
import { PartPage } from './PartPage';
import { QuickCheckPage } from './QuickCheckPage';
import { TrainingHub } from './TrainingHub';
import { TrainingLevelPage } from './TrainingLevelPage';
import { TrainingProviderPage } from './TrainingProviderPage';

/**
 * bd-fmf24g.5 / bd-fmf24g.12 — the teacher v2 Training pages (each flag-gated by App's TeacherGate), every
 * one drawn in the v2 look. The hub, a provider and a level are the v2 pages' own; a course, a part, the
 * quick check, both exams, certificates and My grades restyle the new UI's screens over the same hooks
 * (useTrainingCourse, useTrainingPart, useQuickCheck, useLevelExam, useModuleExam, useTrainingCertificates,
 * useTrainingGrades): every read, rule and gate is theirs. Every link stays under /portal/teacher/training
 * (trainingBase). The main page is registered, so every link to Training (the bottom menu, Home's tile,
 * More) comes here for a teacher with portal_teacher_v2; flag off, today's page as before.
 */
const routes: TeacherRoute[] = [
  { path: B, element: <TrainingHub /> },
  { path: `${B}/provider/:vendorKey`, element: <TrainingProviderPage /> },
  { path: `${B}/provider/:vendorKey/level/:levelId`, element: <TrainingLevelPage /> },
  { path: `${B}/provider/:vendorKey/level/:levelId/exam`, element: <LevelExamPage /> },
  { path: `${B}/provider/:vendorKey/level/:levelId/course/:browseCourseId`, element: <CoursePage /> },
  { path: `${B}/unit/:moduleId`, element: <PartPage /> },
  { path: `${B}/unit/:moduleId/quiz`, element: <QuickCheckPage /> },
  { path: `${B}/exam/:courseId`, element: <ModuleExamPage /> },
  { path: `${B}/certificates`, element: <CertificatesPage /> },
  { path: `${B}/grades`, element: <GradesPage /> },
];

export default routes;
