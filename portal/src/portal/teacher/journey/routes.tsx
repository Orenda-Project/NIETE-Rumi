import type { TeacherRoute } from '../routes';
import { lazyPage as page } from '@/lib/lazyPage';
import { JOURNEY_PATH } from './paths';

/** My journey (dark unless portal_teacher_journey: off, the page sends her back to Home). */
const JourneyPage = page(() => import('./JourneyPage').then((m) => ({ default: m.JourneyPage })));

const routes: TeacherRoute[] = [{ path: JOURNEY_PATH, element: <JourneyPage /> }];
export default routes;
