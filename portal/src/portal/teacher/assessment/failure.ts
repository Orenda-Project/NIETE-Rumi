import { ASSESSMENT, type AssessmentV2Copy } from './copy';

/** The bot's failure code (GET /assessment/status errorCode) as a short label; anything else, the fallback. */
export function failureLabel(code?: string | null, C: AssessmentV2Copy = ASSESSMENT.en): string {
  return (code && C.failures[code]) || C.failureFallback;
}
