import type { TeacherRoute } from '../routes';
import { lazyPage as page } from '@/lib/lazyPage';
import { HELP_LIST_PATH } from './names';

/** bd-ik5e8j.4 — More → How to use (dark unless portal_help_videos: the page sends her back to More). */
const HelpListPage = page(() => import('./HelpListPage'));

const routes: TeacherRoute[] = [{ path: HELP_LIST_PATH, element: <HelpListPage /> }];
export default routes;
