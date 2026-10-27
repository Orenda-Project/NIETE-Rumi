/**
 * Round 7b item 14 (sa_cwpm): the tasks whose per-minute number is words — the familiar words and the passage, in Urdu
 * and English. Their number is correct words per minute (the scorer: correct words × 60 ÷ the seconds the child read,
 * 60 at most), labelled CWPM. Letters and maths keep "correct per minute"; the passage's questions have no rate.
 */
export function isWordsTask(taskId: string | null | undefined): boolean {
  return /^(ur|en)\.(words|story)/.test(String(taskId || '')) && !/comp/.test(String(taskId || ''));
}
