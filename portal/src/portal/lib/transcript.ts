/**
 * bd-5rz1v — "What was said in class". Transcription stores the lesson one turn
 * per paragraph as `[mm:ss] Speaker (LANG): words` (see the bot's
 * transcription formatter). A line that does not fit is kept as plain words
 * rather than dropped: the transcript is hers, and losing a line is worse than
 * showing it without a speaker.
 */

export type TranscriptLine = { at: string | null; who: string | null; text: string };

const TURN = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:()]+?)\s*(?:\([A-Za-z]{2,3}\))?\s*:\s*([\s\S]*)$/;

export function parseTranscript(text: string | null | undefined): TranscriptLine[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/\n\s*\n|\n(?=\[\d)/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(TURN);
      return m ? { at: m[1], who: m[2].trim(), text: m[3].trim() } : { at: null, who: null, text: p };
    });
}
