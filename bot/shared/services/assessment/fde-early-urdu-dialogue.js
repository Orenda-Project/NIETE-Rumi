'use strict';
/**
 * G2 Urdu Q9 dialogue levels (bd-5jmnfj.36). The slot's prompt_rule asks for a model dialogue of five turns, each written with
 * the speaker's name before it («پہلا دوست: ... دوسرا دوست: ...»), and a scheme of five K points of 2 marks (the name 1, the
 * sentence 1). Nothing checked it: writingMarking only repairs the level wording, so four turns or three points still printed.
 * `dialogueOk` is the slot's `answer_ok`: false sends the item to the writer's existing re-ask. Pure.
 */

const TURNS = 5;
const MARKS_EACH = 2;
const COLON = /[:：]/;
const words = (s) => String(s || '').split(/\s+/).filter(Boolean);

/** The turns of an answer: the text after each speaker label. A label is the one or two words before a colon. */
function turnsOf(answer) {
  const parts = String(answer || '').split(COLON);
  if (parts.length < 2) return { labelled: false, texts: [] };
  const texts = [];
  for (let i = 1; i < parts.length; i += 1) {
    const w = words(parts[i]);
    const next = i < parts.length - 1;
    const body = next ? w.slice(0, Math.max(0, w.length - 2)) : w; // the last two words of a middle segment are the next speaker's name
    texts.push(body.join(' '));
  }
  const first = words(parts[0]);
  return { labelled: first.length >= 1 && first.length <= 2, texts };
}

function dialogueOk(q) {
  if (!q || typeof q !== 'object') return false;
  const { labelled, texts } = turnsOf(q.answer);
  if (!labelled || texts.length !== TURNS || texts.some((t) => !t.trim())) return false;
  const pts = q.scheme && q.scheme.points;
  return Array.isArray(pts) && pts.length === TURNS && pts.every((p) => p && Number(p.marks) === MARKS_EACH);
}

module.exports = { dialogueOk, turnsOf };
