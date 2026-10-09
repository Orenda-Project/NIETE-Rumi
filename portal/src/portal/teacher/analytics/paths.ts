import { featurePath } from '../paths';

/** bd-fmf24g.8 — where the teacher v2 Analytics page lives. */
export const ANALYTICS_HOME = featurePath('analytics');

/** bd-fmf24g.27 — one teacher's analytics (a principal's school view opens it). */
export const ANALYTICS_TEACHER = `${ANALYTICS_HOME}/teacher/:id`;
