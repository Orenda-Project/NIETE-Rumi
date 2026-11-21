'use strict';
/**
 * The evening round's recall pool and its reading items (switch `web_quiz_evening_round`, OFF by default).
 *
 *   missesFor({ classId, day, enrolled, teacherIds })  the class's misses 2-3 PKT days before `day`: answers marked
 *                                    wrong in a session that FINISHED on PKT day D-2 or D-3, by a child enrolled in
 *                                    the class, on a quiz whose share code carries this class, or whose teacher
 *                                    teaches it. Up to POOL_MAX originals, most-missed first; each with the
 *                                    children who missed it (ids, kept server-side only).
 *   rewrite({ originals, language, complete })  ONE model call for the whole pool: each original becomes a NEW
 *                                    question on the same skill (never the same item); a reply that repeats its
 *                                    original, or is malformed, is dropped alone.
 *   recallRows({ quizId, items, roundKey, chipOf })  the quiz_questions rows of the rewritten items: each marks
 *                                    which original it recalls, its rank, and the children who missed that
 *                                    original as one-way keys (never an id or a name).
 *   isReadingItem(row, subject) / markReading(row)  an item the child must read for themselves is shown, NOT
 *                                    spoken: `media.self_read` and, on a web item, `media.web.read.self`
 *                                    (the page's `read.self`, which wq.js readParts honours by speaking nothing).
 *
 * Suspect answer keys: a key-review module (`quiz-key-review.js` exporting suspectIds(questionIds) -> Set) is asked
 * when present, and its suspects never enter the pool; absent, nothing is excluded (suspectFilter).
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const POOL_MAX = 6;
const IN_CHUNK = 200;
const SLOTS = ['A', 'B', 'C', 'D'];
const PKT_MS = 5 * 3600 * 1000;
const DAY_MS = 86400000;
const MAX_TEXT = 400;
const LANGUAGE_SUBJECTS = /^(english|urdu|eng|urd)/i;
// The stem asks the child to read a text themselves ("Read the sentence…", «جملہ پڑھیں…»).
const READ_RX = /\b(read|reads|reading)\b|پڑھ/i;
// A quoted text of four or more words that the question is about.
const QUOTED_RX = /["“«'‘]([^"”»'’]{3,})["”»'’]/;
const PICTURE_RX = /\b(picture|pictures|diagram|figure|drawing|image|look at)\b|تصویر|شکل|خاکہ/i;

const chunks = (xs, n = IN_CHUNK) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };

/** The UTC instants of PKT midnight starting a 'YYYY-MM-DD' day, shifted by `days`. */
function pktMidnight(day, days = 0) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 0, 0, 0) - PKT_MS);
}

/** The window of finishes a round on `day` recalls: from PKT D-3 00:00 up to (not including) PKT D-1 00:00. */
function missWindow(day) {
  return { from: pktMidnight(day, -3).toISOString(), to: pktMidnight(day, -1).toISOString() };
}

/** A one-way key for a child within one round (never the id, never reversible without it). */
function kidKey(roundKey, studentId) {
  return crypto.createHash('sha256').update(`er|${roundKey}|${studentId}`).digest('hex').slice(0, 16);
}

async function suspectFilter(questionIds) {
  try {
    // eslint-disable-next-line global-require
    const Keys = require('./quiz-key-review');
    if (Keys && typeof Keys.suspectIds === 'function') {
      const s = await Keys.suspectIds(questionIds);
      return s instanceof Set ? s : new Set(s || []);
    }
  } catch (_) { /* no key review on this build: nothing is excluded */ }
  return new Set();
}

/**
 * The class's misses 2-3 PKT days before `day`. Reads (all IN-chunked): quiz_sessions, quiz_share_codes, quizzes,
 * quiz_answers, quiz_questions. Returns [{ question, quiz, missedBy:[studentId], n }] most-missed first, ties by the
 * later finish; at most POOL_MAX. Throws on a read error (the writer skips the class and logs it).
 */
async function missesFor({ classId, day, enrolled = [], teacherIds = [] }) {
  const ids = [...new Set(enrolled.filter(Boolean).map(String))];
  if (!ids.length) return [];
  const { from, to } = missWindow(day);
  const sessions = [];
  for (const part of chunks(ids)) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('quiz_sessions').select('id, student_id, quiz_id, share_code_id, completed_at')
      .in('student_id', part).gte('completed_at', from).lt('completed_at', to);
    if (error) throw new Error(`recall: sessions: ${error.message}`);
    sessions.push(...(data || []));
  }
  if (!sessions.length) return [];
  const codeIds = [...new Set(sessions.map((s) => s.share_code_id).filter(Boolean))];
  const quizIds = [...new Set(sessions.map((s) => s.quiz_id).filter(Boolean))];
  const codeClass = new Map();
  for (const part of chunks(codeIds)) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('quiz_share_codes').select('id, class_id').in('id', part);
    if (error) throw new Error(`recall: codes: ${error.message}`);
    (data || []).forEach((r) => codeClass.set(r.id, r.class_id || null));
  }
  const quizRow = new Map();
  for (const part of chunks(quizIds)) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('quizzes').select('id, teacher_id, subject, grade, language, meta').in('id', part);
    if (error) throw new Error(`recall: quizzes: ${error.message}`);
    (data || []).forEach((q) => quizRow.set(q.id, q));
  }
  const teachers = new Set(teacherIds.map(String));
  const mine = sessions.filter((s) => {
    const q = quizRow.get(s.quiz_id);
    // A round recalls lesson items only: an earlier round's own rewrites are not recalled again.
    if (q && q.meta && q.meta.source === 'evening_round') return false;
    return codeClass.get(s.share_code_id) === classId || (q && teachers.has(String(q.teacher_id)));
  });
  if (!mine.length) return [];
  const bySession = new Map(mine.map((s) => [s.id, s]));
  const tally = new Map(); // question_id -> { kids:Set, last }
  for (const part of chunks([...bySession.keys()])) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('quiz_answers').select('session_id, question_id, is_correct').in('session_id', part).eq('is_correct', false);
    if (error) throw new Error(`recall: answers: ${error.message}`);
    for (const a of data || []) {
      const s = bySession.get(a.session_id);
      if (!s || !a.question_id) continue;
      const t = tally.get(a.question_id) || { kids: new Set(), last: '', quizId: s.quiz_id };
      t.kids.add(String(s.student_id));
      if (String(s.completed_at) > t.last) t.last = String(s.completed_at);
      tally.set(a.question_id, t);
    }
  }
  if (!tally.size) return [];
  const suspects = await suspectFilter([...tally.keys()]);
  const ranked = [...tally.entries()].filter(([qid]) => !suspects.has(qid))
    .sort((a, b) => (b[1].kids.size - a[1].kids.size) || b[1].last.localeCompare(a[1].last) || a[0].localeCompare(b[0]));
  const want = ranked.slice(0, POOL_MAX * 2).map(([qid]) => qid);
  const qRows = new Map();
  for (const part of chunks(want)) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('quiz_questions')
      .select('id, quiz_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, media').in('id', part);
    if (error) throw new Error(`recall: questions: ${error.message}`);
    (data || []).forEach((r) => qRows.set(r.id, r));
  }
  return ranked.filter(([qid]) => qRows.has(qid) && String(qRows.get(qid).question_text || '').trim()).slice(0, POOL_MAX)
    .map(([qid, t]) => ({ question: qRows.get(qid), quiz: quizRow.get(t.quizId) || null, missedBy: [...t.kids].sort(), n: t.kids.size }));
}

// ── the rewrite (one call per class) ─────────────────────────────────────────────────────────────

function optionsOf(q) {
  return [q.option_a, q.option_b, q.option_c, q.option_d].map((o) => (o == null ? '' : String(o).trim())).filter(Boolean);
}
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}]+/gu, ' ').trim();

function buildPrompt(originals, language) {
  const lang = language === 'ur' ? 'Urdu (Nastaliq script; numbers as Urdu digits ۰۱۲۳۴۵۶۷۸۹ inside Urdu text)' : 'English';
  const list = originals.map((o, i) => ({
    i,
    question: String(o.question.question_text || '').slice(0, MAX_TEXT),
    options: optionsOf(o.question).map((t, k) => `${SLOTS[k]}: ${t.slice(0, 120)}`),
    correct: String(o.question.correct_option || '').trim().toUpperCase(),
    explanation: String(o.question.explanation || '').slice(0, MAX_TEXT),
    subject: (o.quiz && o.quiz.subject) || null,
    grade: (o.quiz && o.quiz.grade) || null,
  }));
  return `A primary-school class answered these questions wrongly two or three days ago. For EACH one, write ONE NEW question that checks the SAME skill, for the same grade, in ${lang}.
Rules for every new question:
- It is NOT the same question: change the numbers, the words, the example or the order, so that remembering the old answer does not answer it.
- Exactly one correct option; 3 or 4 short options; no "all of the above" / "none of the above".
- No picture, diagram or figure, and no reference to one: the child sees only text.
- The stem is short and clear for a young child; gender-neutral (never he/she for the child).
- "explanation" is one short sentence saying why the right answer is right.
- "reading" is true only when the child must read a word, sentence or passage THEMSELVES to answer (a reading-skill question); otherwise false.
Return JSON only: {"items":[{"i":<the i you were given>,"question":"","options":["",""],"correct":"A","explanation":"","reading":false}]}

The questions:
${JSON.stringify(list, null, 1)}`;
}

/** One rewritten item, checked; null when unusable (malformed, a repeat of its original, or a picture item). */
function checkItem(raw, original) {
  if (!raw || typeof raw !== 'object') return null;
  const question = String(raw.question || '').trim();
  const options = (Array.isArray(raw.options) ? raw.options : []).map((o) => String(o == null ? '' : o).trim()).filter(Boolean).slice(0, 4);
  const correct = String(raw.correct || '').trim().toUpperCase().charAt(0);
  const k = SLOTS.indexOf(correct);
  if (!question || options.length < 2 || k < 0 || k >= options.length) return null;
  if (new Set(options.map(norm)).size !== options.length) return null;
  if (PICTURE_RX.test(question)) return null;
  // Never the same item: a stem the same as the original's, or the same stem with the same options, is refused.
  const orig = original.question;
  if (norm(question) === norm(orig.question_text)) return null;
  return { question, options, correct, explanation: String(raw.explanation || '').trim() || null, reading: raw.reading === true };
}

/**
 * The pool rewritten in ONE call. `complete` is transcript-quiz-llm completeJson (the model client boundary).
 * Returns { items:[{ original, question, options, correct, explanation, reading }], costUsd, model, usage, dropped }.
 * A failed call returns no items (the round goes out with its lesson items only), never throws.
 */
async function rewrite({ originals, language = 'en', complete }) {
  if (!originals || !originals.length) return { items: [], costUsd: 0, model: null, usage: null, dropped: 0 };
  try {
    const out = await complete({ prompt: buildPrompt(originals, language), maxTokens: 6000, label: 'evening_round_recall' });
    const got = Array.isArray(out && out.json && out.json.items) ? out.json.items : [];
    const items = [];
    originals.forEach((o, i) => {
      const it = checkItem(got.find((g) => g && Number(g.i) === i), o);
      if (it) items.push({ original: o, ...it });
    });
    return { items, costUsd: (out && out.costUsd) || 0, model: (out && out.model) || null, usage: (out && out.usage) || null, dropped: originals.length - items.length };
  } catch (err) {
    logToFile('⚠️ evening round: recall rewrite failed — the round goes out with its lesson items only', { error: err.message });
    return { items: [], costUsd: (err && err.costUsd) || 0, model: null, usage: null, dropped: originals.length, error: err.message };
  }
}

// ── reading items ──────────────────────────────────────────────────────────────────────────────

/**
 * Must the child read this item for themselves? A language subject (English / Urdu) whose stem asks the child to read
 * ("Read…", «…پڑھیں») or quotes a text of four or more words to answer about. Other subjects are always spoken.
 */
function isReadingItem(row, subject) {
  if (!row || !LANGUAGE_SUBJECTS.test(String(subject || ''))) return false;
  const w = row.media && row.media.web;
  const stem = String((w && w.stem) || row.question_text || '');
  if (READ_RX.test(stem)) return true;
  const m = QUOTED_RX.exec(stem);
  return Boolean(m && m[1].trim().split(/\s+/).length >= 4);
}

/** The row with its reading mark: media.self_read, and media.web.read.self on a web item (the page's read.self). */
function markReading(row) {
  const media = { ...(row.media || {}), self_read: true };
  if (media.web && typeof media.web === 'object') media.web = { ...media.web, read: { ...(media.web.read || {}), self: true } };
  return { ...row, media };
}

// ── the rows ───────────────────────────────────────────────────────────────────────────────────

/**
 * The quiz_questions rows for the rewritten pool. external_id `tq:rc<rank>:recall:<original 8>` keeps the transcript
 * bank's order rule (sort_order) and sorts after the lesson items (sort_order 100 + rank).
 * media.round 'recall'; media.recall = { of, rank, kids (one-way keys of the children who missed it), chips (their
 * chips on this round's code, so the page's ?k= picks them without a read) }.
 */
function recallRows({ quizId, items, roundKey, chipOf = () => null, subject }) {
  return items.map((it, idx) => {
    const rank = idx + 1;
    const opts = it.options;
    let row = {
      quiz_id: quizId,
      external_id: `tq:rc${rank}:recall:${String(it.original.question.id).slice(0, 8)}`,
      sort_order: 100 + rank,
      question_text: it.question,
      option_a: opts[0] || null, option_b: opts[1] || null, option_c: opts[2] || null, option_d: opts[3] || null,
      correct_option: it.correct,
      explanation: it.explanation,
      media: {
        round: 'recall',
        round_key: roundKey,
        recall: {
          of: it.original.question.id,
          rank,
          kids: it.original.missedBy.map((id) => kidKey(roundKey, id)),
          chips: it.original.missedBy.map((id) => chipOf(id)).filter(Boolean),
        },
      },
    };
    if (it.reading || isReadingItem(row, subject)) row = markReading(row);
    return row;
  });
}

module.exports = {
  POOL_MAX, missWindow, missesFor, rewrite, buildPrompt, checkItem, recallRows, isReadingItem, markReading, kidKey, suspectFilter, pktMidnight,
};
