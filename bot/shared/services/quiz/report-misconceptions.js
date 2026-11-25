'use strict';
/**
 * The teacher's live quiz report: "what your class got wrong, and the likely confusion" (queue #299, bd-vo9fkc).
 *
 * app_settings `quiz_report_misconceptions` (on only when JSON true). On, quizReport() carries `misconceptions`: each
 * question where ONE wrong answer drew the class (at least MIN_PICKED children, at least CLUSTER_THRESHOLD of the wrong
 * answers, strictly more than any other wrong answer), with the option the class picked, the right answer, and that
 * option's authored feedback (`option_feedback.wrong[index]`, made teacher-facing) as the likely confusion.
 *
 * ONLY a question whose answer key a person confirmed right: a quiz_item_reviews row with status key_ok or fixed, and
 * no row still holding it (quiz-key-review HELD: open, key_wrong, ambiguous). A key nobody reviewed is not shown, so a
 * wrong key can never be printed as the class's misconception.
 *
 * Off, an unreadable switch: no `misconceptions` key and no extra read; the report is today's byte for byte. A failed
 * review or feedback read: an empty list (no block). The page only: nothing is sent on WhatsApp.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { settingsGroup } = require('../settings-group');
const FoldFlag = require('./report-fold-flag');

const KEY = 'quiz_report_misconceptions';
const TTL_MS = 30 * 1000;
const LETTERS = ['A', 'B', 'C', 'D'];
const CONFIRMED = ['key_ok', 'fixed'];
const HELD = ['open', 'key_wrong', 'ambiguous'];   // quiz-key-review.service HELD
const CLUSTER_THRESHOLD = 0.5;                    // video-quiz-report "most missed" uses the same share
const MIN_PICKED = 2;                             // one child's slip is not a class pattern
const LIMIT = 3;
const CHUNK = 200;
const group = settingsGroup(FoldFlag.KEY, [KEY], TTL_MS);

/**
 * Whether the switch is on: exactly JSON true. Never throws: an unreadable row is off. It rides the report's fold
 * switch read (settings-group, as quiz_reminder_live_preview does), so the report reads app_settings as often as before.
 */
async function on(now = Date.now()) {
  try {
    const { data, error } = await group.rider(KEY, now);
    if (error) throw new Error(error.message || 'app_settings read failed');
    return Boolean(data) && data.value === true;
  } catch (err) {
    logToFile('⚠️ quiz report: misconceptions setting unreadable — block off', { error: err && err.message });
    return false;
  }
}

/** Pure: the question's one dominant wrong option, or null. `picks` is {letter: count} over wrong answers only. */
function dominantWrong(picks, wrongN) {
  const ranked = Object.entries(picks || {}).filter(([l]) => LETTERS.includes(l)).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || !wrongN) return null;
  const [[letter, n], second] = ranked;
  if (n < MIN_PICKED || n / wrongN < CLUSTER_THRESHOLD || (second && second[1] >= n)) return null;
  return { letter, n };
}

/** Pure: "Good try! They think … Keep going!" → "They think …". */
function teacherFacing(raw) {
  if (!raw) return null;
  const t = String(raw).replace(/^\s*[A-D]\)\s*/, '').trim()
    .replace(/^(good try|nice effort|not quite|almost|good effort|nice try|well tried)[!.,]*\s*/i, '').trim()
    .replace(/\s*(keep going|keep learning|keep it up|keep practising|keep practicing|well done|you can do it)[!.]*\s*$/i, '').trim();
  return t || null;
}

/** The ids among `ids` whose key a person confirmed and nothing still holds. Throws on a failed read. */
async function confirmedAmong(ids) {
  const verdicts = new Map();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase.from('quiz_item_reviews').select('question_id, status').in('question_id', ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message || 'quiz_item_reviews read failed');
    (data || []).forEach((r) => {
      if (!verdicts.has(r.question_id)) verdicts.set(r.question_id, []);
      verdicts.get(r.question_id).push(r.status);
    });
  }
  const ok = new Set();
  verdicts.forEach((st, id) => { if (st.some((s) => CONFIRMED.includes(s)) && !st.some((s) => HELD.includes(s))) ok.add(id); });
  return ok;
}

/**
 * The block for one quiz. `stats`: [{ id, n, text, answered, wrongN, picks, row }] where `row` is the quiz_questions
 * row (options and correct_option). Never throws: a failed read is an empty list.
 */
async function forQuiz(stats) {
  const candidates = (stats || []).map((s) => ({ s, top: dominantWrong(s.picks, s.wrongN) })).filter((c) => c.top);
  if (!candidates.length) return [];
  try {
    const ok = await confirmedAmong(candidates.map((c) => c.s.id));
    const kept = candidates.filter((c) => ok.has(c.s.id))
      .sort((a, b) => (b.top.n / b.s.answered) - (a.top.n / a.s.answered) || a.s.n - b.s.n).slice(0, LIMIT);
    if (!kept.length) return [];
    const { data, error } = await supabase.from('quiz_questions').select('id, option_feedback').in('id', kept.map((c) => c.s.id));
    if (error) throw new Error(error.message || 'option_feedback read failed');
    const fb = new Map((data || []).map((r) => [r.id, r.option_feedback]));
    return kept.map(({ s, top }) => {
      const wrong = (fb.get(s.id) || {}).wrong || {};
      const idx = LETTERS.indexOf(top.letter);   // feedback is keyed by the option INDEX, not its letter
      const key = String(s.row.correct_option || '').toUpperCase();
      return {
        n: s.n,
        text: s.text,
        pick: { option: top.letter, text: s.row[`option_${top.letter.toLowerCase()}`] || '' },
        right: { option: key, text: s.row[`option_${key.toLowerCase()}`] || '' },
        picked: top.n,
        answered: s.answered,
        confusion: teacherFacing(wrong[String(idx)] ?? wrong[idx]),
      };
    });
  } catch (err) {
    logToFile('⚠️ quiz report: misconceptions read failed — no block', { error: err && err.message });
    return [];
  }
}

/** Tests only: forget the cached reading. */
function reset() { group.forget(KEY); }

module.exports = { on, forQuiz, dominantWrong, teacherFacing, confirmedAmong, reset, KEY, CONFIRMED, HELD, MIN_PICKED, LIMIT };
