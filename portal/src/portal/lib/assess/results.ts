/**
 * Where one Learning assessment session's results page lives. The URL carries the
 * session id only, never a child's name (the page asks the server for the rest).
 */
export function resultsPath(sessionId: string): string {
  return `/portal/leader/assess/results/${encodeURIComponent(sessionId)}`;
}
