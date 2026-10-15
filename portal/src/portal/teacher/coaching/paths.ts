import { featurePath } from '../paths';

/** bd-fmf24g.4 — where the teacher v2 Digital Coaching pages live. */
export const COACHING_HOME = featurePath('coaching');
/** The recording page, and the sending that follows Submit (SendPage). The recording bar's Return comes here. */
export const COACHING_SEND = `${COACHING_HOME}/send`;

/** The one screen (Assessment's flow): Grade and subject, Recording, Lesson plan, Photos, Submit, then its progress. */
export const COACHING_NEW = `${COACHING_HOME}/new`;

/** All DC observations (the main page's Summary). */
export const COACHING_ALL = `${COACHING_HOME}/all`;

/** One lesson's page: its progress while it is analysed, then its report (ReportPage). */
export const COACHING_REPORT = `${COACHING_HOME}/report/:id`;

export function lessonPath(sessionId: string): string {
  return COACHING_REPORT.replace(':id', encodeURIComponent(sessionId));
}
