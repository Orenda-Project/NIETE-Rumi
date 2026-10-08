import { featurePath } from '../paths';

/** bd-fmf24g.4 — where the teacher v2 Observations pages live. */
export const OBS_HOME = featurePath('observations');
/** A coach visit's report: the shared report page (coaching/ReportPage). */
export const OBS_REPORT = `${OBS_HOME}/report/:id`;

export function obsReportPath(sessionId: string): string {
  return OBS_REPORT.replace(':id', encodeURIComponent(sessionId));
}
