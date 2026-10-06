/**
 * What she is told, per failure code, in words that name the thing she can
 * change. The bot has its own copy of these for WhatsApp; this is the same set
 * of situations phrased for a page rather than a chat.
 *
 * bd-t5tow — moved here from AssessmentGeneratorPanel so the failure toast and
 * the "Being made" row in My papers read from the one list.
 */
export const FAILURE_MESSAGE: Record<string, string> = {
  BOOK_NOT_FOUND: "We don't have that book yet. Try a different class or subject.",
  CHAPTER_NOT_FOUND: "We couldn't find that chapter. Please pick another one.",
  NO_CONTENT: "We don't have the text for that chapter yet — please try another chapter.",
  PAGE_OUT_OF_RANGE: 'Those page numbers are outside this book. Please check and try again.',
  INVALID_PAGE_RANGE: "Those page numbers didn't make sense. Try something like 4-14.",
  TRUNCATED: 'That was a lot to write in one go. Please try again with fewer questions.',
  MODEL_UNAVAILABLE: "Sorry — we couldn't build your paper just now. Please try again in a moment.",
  BAD_JSON: "Sorry — that didn't come out right. Please try again.",
  NO_QUESTIONS: "Sorry — we couldn't write questions from that chapter. Please try another.",
  RENDER_FAILED: "Sorry — we couldn't make the file. Please try again.",
  UPLOAD_FAILED: "Sorry — we couldn't save your paper. Please try again.",
};
export const FAILURE_FALLBACK = 'Sorry — something went wrong making your paper. Please try again.';

/** The sentence for a failure code, or the fallback for an unknown or missing one. */
export const failureMessage = (code?: string | null): string =>
  (code && FAILURE_MESSAGE[code]) || FAILURE_FALLBACK;
