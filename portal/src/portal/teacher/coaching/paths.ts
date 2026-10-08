import { featurePath } from '../paths';

/** bd-fmf24g.4 — where the teacher v2 Digital Coaching pages live. */
export const COACHING_HOME = featurePath('coaching');
/** Record → Check and send → Sent, one page (SendPage). The recording bar's Return comes here. */
export const COACHING_SEND = `${COACHING_HOME}/send`;

/** A lesson's report. Today's lesson page until the v2 report page is registered. */
export function lessonPath(sessionId: string): string {
  return `/portal/coaching/session/${encodeURIComponent(sessionId)}`;
}
