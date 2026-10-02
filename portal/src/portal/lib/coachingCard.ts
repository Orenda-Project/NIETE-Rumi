/**
 * A coaching card stored before observation scores became bands carries its
 * old "— currently 1/2" suffix. Stored text is not rewritten, so the score is
 * taken off at display time; new cards are written with the band instead.
 * Shared by the report page and the bd-5rz1v lesson page.
 */
export function withoutScore(action: string): string {
  return action.replace(/\s*—\s*currently\s+\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?/g, '');
}
