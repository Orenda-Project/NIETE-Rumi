import { ASSESSMENT, type AssessmentV2Copy } from './copy';

/** Codes that are another code's case for the teacher: a board-pattern paper that came out short "came out wrong". */
const SAME_AS: Record<string, string> = { PATTERN_SHORT_SLOT: 'BAD_JSON' };

/** The bot's failure code (GET /assessment/status errorCode) as a short label; anything else, the fallback. */
export function failureLabel(code?: string | null, C: AssessmentV2Copy = ASSESSMENT.en): string {
  const key = code ? SAME_AS[code] ?? code : null;
  return (key && C.failures[key]) || C.failureFallback;
}

/** "11:40 AM" in Pakistan time, for "try again at …". */
function clock(iso: string | null): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' }).format(t);
}

/** The server's refusal of a Make (POST /assessment/generate) in the teacher's words (copy deck §A); null = show the server's message. */
export function generateFailureText(code: string | null | undefined, retryAt: string | null, C: AssessmentV2Copy): string | null {
  switch (code) {
    case 'PATTERN_OFF': return C.fdeFailures.PATTERN_OFF;
    case 'ALREADY_GENERATING': return C.fdeFailures.ALREADY_GENERATING;
    case 'RATE_LIMITED': return C.fdeFailures.RATE_LIMITED(clock(retryAt));
    default: return null;
  }
}
