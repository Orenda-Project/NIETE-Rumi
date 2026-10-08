import { featurePath } from '../paths';

/** bd-fmf24g.4 — where the teacher v2 Digital Coaching pages live. */
export const COACHING_HOME = featurePath('coaching');
/** Record → Check and send → Sent, one page (SendPage). The recording bar's Return comes here. */
export const COACHING_SEND = `${COACHING_HOME}/send`;

/** One lesson's page: its progress while it is analysed, then its report (ReportPage). */
export const COACHING_REPORT = `${COACHING_HOME}/report/:id`;

export function lessonPath(sessionId: string): string {
  return COACHING_REPORT.replace(':id', encodeURIComponent(sessionId));
}
