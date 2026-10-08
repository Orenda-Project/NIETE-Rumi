import { ASSESSMENT_V2_COPY as C } from './copy';

/** The bot's failure code (GET /assessment/status errorCode) as a short label; anything else, the fallback. */
export function failureLabel(code?: string | null): string {
  return (code && C.failures[code]) || C.failureFallback;
}
