import type { TeacherRoute } from '../routes';
import { AssessmentAll } from './AssessmentAll';
import { AssessmentHub } from './AssessmentHub';
import { EditPaperPage, EditQuestionPage } from './EditPages';
import { CheckStep, ClassStep, CoverStep, ExtrasStep, QuestionsStep, TypesStep } from './NewPaperSteps';
import { PaperPage, VersionsPage } from './PaperPage';
import { ASSESSMENT_ALL, ASSESSMENT_V2_BASE as B } from './paths';
import { RequestPage } from './RequestPage';

/**
 * bd-fmf24g.6 — the teacher v2 Assessment pages (each flag-gated by App's TeacherGate). The main page is
 * registered, so every link to Assessment (Home's tile, More) comes here for a teacher with
 * portal_teacher_v2; flag off, today's /portal/assessment as before.
 */
const routes: TeacherRoute[] = [
  { path: B, element: <AssessmentHub /> },
  { path: ASSESSMENT_ALL, element: <AssessmentAll /> },
  { path: `${B}/new/class`, element: <ClassStep /> },
  { path: `${B}/new/cover`, element: <CoverStep /> },
  { path: `${B}/new/questions`, element: <QuestionsStep /> },
  { path: `${B}/new/types`, element: <TypesStep /> },
  { path: `${B}/new/extras`, element: <ExtrasStep /> },
  { path: `${B}/new/check`, element: <CheckStep /> },
  { path: `${B}/request/:requestId`, element: <RequestPage /> },
  { path: `${B}/paper/:paperId`, element: <PaperPage /> },
  { path: `${B}/paper/:paperId/versions`, element: <VersionsPage /> },
  { path: `${B}/paper/:paperId/edit`, element: <EditPaperPage /> },
  { path: `${B}/paper/:paperId/edit/q/:key`, element: <EditQuestionPage mode="edit" /> },
  { path: `${B}/paper/:paperId/edit/add/:kind`, element: <EditQuestionPage mode="add" /> },
];

export default routes;
