import type { TeacherRoute } from '../routes';
import TrainingCertificates from '../../newui/training/TrainingCertificates';
import TrainingCourse from '../../newui/training/TrainingCourse';
import TrainingGrades from '../../newui/training/TrainingGrades';
import TrainingLevelExam from '../../newui/training/TrainingLevelExam';
import TrainingModuleExam from '../../newui/training/TrainingModuleExam';
import TrainingPart from '../../newui/training/TrainingPart';
import TrainingQuiz from '../../newui/training/TrainingQuiz';
import { TRAINING_V2_BASE as B } from './model';
import { TrainingHub } from './TrainingHub';
import { TrainingLevelPage } from './TrainingLevelPage';
import { TrainingProviderPage } from './TrainingProviderPage';
import { InV2Frame } from './TrainingFrame';

/**
 * bd-fmf24g.5 — the teacher v2 Training pages (each flag-gated by App's TeacherGate). The hub, a provider
 * and a level are drawn fresh in the v2 look; a course, a part, the quick check, both exams, certificates
 * and My grades are the new UI's screens — their logic, reads and gates untouched — in the v2 frame
 * (InV2Frame). Every link they build stays under /portal/teacher/training (trainingBase). The main page is
 * registered, so every link to Training (the bottom menu, Home's tile, More) comes here for a teacher with
 * portal_teacher_v2; flag off, today's page as before.
 */
const reused = (el: JSX.Element) => <InV2Frame>{el}</InV2Frame>;

const routes: TeacherRoute[] = [
  { path: B, element: <TrainingHub /> },
  { path: `${B}/provider/:vendorKey`, element: <TrainingProviderPage /> },
  { path: `${B}/provider/:vendorKey/level/:levelId`, element: <TrainingLevelPage /> },
  { path: `${B}/provider/:vendorKey/level/:levelId/exam`, element: reused(<TrainingLevelExam />) },
  { path: `${B}/provider/:vendorKey/level/:levelId/course/:browseCourseId`, element: reused(<TrainingCourse />) },
  { path: `${B}/unit/:moduleId`, element: reused(<TrainingPart />) },
  { path: `${B}/unit/:moduleId/quiz`, element: reused(<TrainingQuiz />) },
  { path: `${B}/exam/:courseId`, element: reused(<TrainingModuleExam />) },
  { path: `${B}/certificates`, element: reused(<TrainingCertificates />) },
  { path: `${B}/grades`, element: reused(<TrainingGrades />) },
];

export default routes;
