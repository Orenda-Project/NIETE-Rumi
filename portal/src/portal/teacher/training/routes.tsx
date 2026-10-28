import type { TeacherRoute } from '../routes';
import { TRAINING_V2_BASE as B } from './model';
import { lazyPage as page } from '@/lib/lazyPage';

// bd-sex15q.34 — each page is its own chunk (lib/lazyPage), so the teacher app is not in every first open.
const CertificatesPage = page(() => import('./CertificatesPage').then((m) => ({ default: m.CertificatesPage })));
const CoursePage = page(() => import('./CoursePage').then((m) => ({ default: m.CoursePage })));
const GradesPage = page(() => import('./GradesPage').then((m) => ({ default: m.GradesPage })));
const LevelExamPage = page(() => import('./LevelExamPage').then((m) => ({ default: m.LevelExamPage })));
const ModuleExamPage = page(() => import('./ModuleExamPage').then((m) => ({ default: m.ModuleExamPage })));
const PartPage = page(() => import('./PartPage').then((m) => ({ default: m.PartPage })));
const QuickCheckPage = page(() => import('./QuickCheckPage').then((m) => ({ default: m.QuickCheckPage })));
const TrainingHub = page(() => import('./TrainingHub').then((m) => ({ default: m.TrainingHub })));
const TrainingLevelPage = page(() => import('./TrainingLevelPage').then((m) => ({ default: m.TrainingLevelPage })));
const TrainingProviderPage = page(() => import('./TrainingProviderPage').then((m) => ({ default: m.TrainingProviderPage })));

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
