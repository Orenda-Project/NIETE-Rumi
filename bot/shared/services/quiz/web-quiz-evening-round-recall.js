'use strict';
/**
 * The evening round's recall pool and its reading items (switch `web_quiz_evening_round`, OFF by default).
 *
 *   missesFor({ classId, day, enrolled, teacherIds })  the class's misses in `day`'s window (missWindow: about two
 *                                    days before, each day in one round only): answers marked wrong in a session
 *                                    that FINISHED in that window, by a child enrolled in
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
 * Held answer keys (heldIds): an item the answer-key review holds (quiz-key-review.service heldQuestionIds(db, ids),
 * required lazily: absent on a build, nothing more is held) or one of KEY_HELD (keys known wrong until their fix
 * runs) never enters the pool, and a round's lesson item copied from such an item is not served. The original's key
 * as the child was graded on it is WebItems.keyFor(row) (the web key when there is one), never row.correct_option.
 *
 * A class that agrees on one wrong answer: before an original enters the pool, keys' own nightly rule (suspectOf)
 * runs on the CLASS's answers to it in the window, by stored option slot, with CLASS_MIN_ANSWERS (a class, not the
 * city) and keys' min_share: one wrong option drawing that share of ALL the answers. Such an original is queued for
 * review (dominant_wrong_option) and kept out; the pool takes the next miss. One a person already reviewed (a queue
 * row whose status no longer holds) enters as before. The count rides on the returned array as `held`.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const POOL_MAX = 6;
const IN_CHUNK = 200;
const PAGE = 1000; // PostgREST's max rows per read
// keys' rule on ONE class's answers: a class of 5 answering one item is enough to see agreement (the nightly's 20 is a city).
const CLASS_MIN_ANSWERS = 5;
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

/** The school day (Mon-Fri) before `day`, as YYYY-MM-DD. */
function prevSchoolDay(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  for (let i = 1; i <= 7; i += 1) {
    const t = new Date(Date.UTC(y, m - 1, d - i));
    const dow = t.getUTCDay();
    if (dow >= 1 && dow <= 5) return t.toISOString().slice(0, 10);
  }
  /* istanbul ignore next: a week always holds a weekday */
  return day;
}

/**
 * The window of finishes a round on school day `day` recalls, so that each miss comes back ONCE: the calendar days after
 * (P - 2) up to and including (day - 2), P = the school day before. Every calendar day belongs to exactly one round
 * (Monday's: Thursday to Saturday; Tuesday's: Sunday; then the day two before). PKT midnights, `to` excluded.
 */
function missWindow(day) {
  return { from: pktMidnight(prevSchoolDay(day), -1).toISOString(), to: pktMidnight(day, -1).toISOString() };
}

/** A one-way key for a child within one round (never the id, never reversible without it). */
function kidKey(roundKey, studentId) {
  return crypto.createHash('sha256').update(`er|${roundKey}|${studentId}`).digest('hex').slice(0, 16);
}

// Answer keys found wrong by hand. Kept held for good: their keys were corrected in production on 22 Nov 2026, so a
// child's miss on one before that day was graded against the wrong key and must not be drilled.
const KEY_HELD = new Set([
  '4e15c1a5-244a-4c0e-800c-604462bc6324', '84145763-bd45-4047-97fa-e27af748bd44', '592c37ea-2759-4c08-b062-0f7948bb2539',
  '59140aee-aec9-4a1f-9d2b-ffe92b9585b0', '1db2d882-e3ce-41ce-ac7f-a2ef62d82025', '1c1fdb10-bf56-46f0-889b-40d251c3fdd3',
  'd7a11f5c-d4b4-4651-9dbf-096804d9b733', '745b4dd2-f6a6-460b-8c54-5c8586c9c162', '1c89a0d7-d43b-4f8e-8a20-c25580697228',
]);

/** The ids among `questionIds` whose key is held: KEY_HELD and the key review's held items. Never throws. */
async function heldIds(questionIds) {
  const ids = [...new Set((questionIds || []).filter(Boolean).map(String))];
  const held = new Set(ids.filter((id) => KEY_HELD.has(id)));
  if (!ids.length) return held;
  let Keys = null;
  // eslint-disable-next-line global-require
  try { Keys = require('./quiz-key-review.service'); } catch (_) { Keys = null; }
  if (!Keys || typeof Keys.heldQuestionIds !== 'function') return held;
  try {
    const got = await Keys.heldQuestionIds(supabase, ids);
    (got instanceof Set ? [...got] : got || []).forEach((id) => held.add(String(id)));
  } catch (err) {
    logToFile('⚠️ evening round: key review unreadable — the fixed list only', { error: err.message });
  }
  return held;
}

/** The key the child was graded on (web-quiz-items keyFor: the web key when there is one). */
function keyOf(row) {
  try {
    return require('./web-quiz-items').keyFor(row) || String(row.correct_option || '').trim().toUpperCase();
  } catch (_) {
    return String((row && row.correct_option) || '').trim().toUpperCase();
  }
}

/**
 * The class's misses in `day`'s window (missWindow). Reads (all IN-chunked): quiz_sessions, quiz_share_codes, quizzes,
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
  const counts = new Map(); // question_id -> { A: n, ... } every answer of the class's sessions, by stored slot
  for (const part of chunks([...bySession.keys()])) {
    for (let from = 0; ; from += PAGE) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase.from('quiz_answers').select('id, session_id, question_id, is_correct, selected_option')
        .in('session_id', part).order('id', { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw new Error(`recall: answers: ${error.message}`);
      for (const a of data || []) {
        const s = bySession.get(a.session_id);
        if (!s || !a.question_id) continue;
        const o = String(a.selected_option || '').trim().toUpperCase();
        if (/^[A-D]$/.test(o)) { const c = counts.get(a.question_id) || {}; c[o] = (c[o] || 0) + 1; counts.set(a.question_id, c); }
        if (a.is_correct !== false) continue;
        const t = tally.get(a.question_id) || { kids: new Set(), last: '', quizId: s.quiz_id };
        t.kids.add(String(s.student_id));
        if (String(s.completed_at) > t.last) t.last = String(s.completed_at);
        tally.set(a.question_id, t);
      }
      if (!data || data.length < PAGE) break;
    }
  }
  if (!tally.size) return [];
  const suspects = await heldIds([...tally.keys()]);
  let ranked = [...tally.entries()].filter(([qid]) => !suspects.has(qid))
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
  ranked = ranked.filter(([qid]) => qRows.has(qid) && String(qRows.get(qid).question_text || '').trim());
  const agreed = await classAgreedWrong(ranked.map(([qid]) => ({ ...qRows.get(qid), question_id: qid, counts: counts.get(qid) || {} })));
  const out = ranked.filter(([qid]) => !agreed.has(qid)).slice(0, POOL_MAX)
    .map(([qid, t]) => ({ question: qRows.get(qid), quiz: quizRow.get(t.quizId) || null, missedBy: [...t.kids].sort(), n: t.kids.size }));
  Object.defineProperty(out, 'held', { value: agreed.size }); // the writer stores it as meta.n_recall_held
  return out;
}

/**
 * The originals among `rows` (question rows with the class's `counts`) that keys' rule calls suspect on this class's
 * answers, queued for review (dominant_wrong_option) unless a person has already reviewed them. Returns the Set held
 * out. Never throws: without keys' module nothing is held; an unreadable queue holds every suspect (and queues it).
 */
async function classAgreedWrong(rows) {
  const held = new Set();
  let Keys = null;
  // eslint-disable-next-line global-require
  try { Keys = require('./quiz-key-review.service'); } catch (_) { Keys = null; }
  if (!Keys || typeof Keys.suspectOf !== 'function' || !rows.length) return held;
  const cfg = { min_share: (Keys.DEFAULTS && Keys.DEFAULTS.min_share) || 0.6, min_answers: CLASS_MIN_ANSWERS };
  const found = rows.map((r) => Keys.suspectOf(r, cfg)).filter(Boolean);
  if (!found.length) return held;
  let reviewed = new Set();
  try {
    const { data, error } = await supabase.from('quiz_item_reviews').select('question_id, status').in('question_id', found.map((f) => f.question_id));
    if (error) throw new Error(error.message);
    const HELD = Array.isArray(Keys.HELD) ? Keys.HELD : ['open', 'key_wrong', 'ambiguous'];
    reviewed = new Set((data || []).filter((r) => !HELD.includes(r.status)).map((r) => String(r.question_id)));
  } catch (err) {
    logToFile('⚠️ evening round: review queue unreadable — every class-agreed original is held', { error: String((err && err.message) || err).slice(0, 200) });
  }
  const queue = found.filter((f) => !reviewed.has(String(f.question_id)));
  queue.forEach((f) => held.add(f.question_id));
  await queueReview(queue.map((f) => ({ ...f, reason: Keys.REASON })));
  return held;
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
    correct: keyOf(o.question),
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

/**
 * The rewritten items blind-solved before any child sees them. The lesson items already passed
 * runKeyVerify in the generate step; a rewrite is written after it, so it gets this solve: WITHOUT a lesson (a rewrite
 * has none: the subject alone decides), the same two-look rule as runKeyVerify's bare pass (ambiguous and
 * none_correct count at once, a disagree only when a second look in another shown order says so too; unsure never
 * blocks). FAIL-CLOSED, unlike the generate step: nobody reviews a round before a child plays it, so a solver that
 * fails keeps no rewrite (the round goes out with its lesson items). `verify` = transcript-quiz-key-verify verifyKeys.
 * A flagged rewrite is never repaired: it comes back in `held` with the solver's pick (the option slot
 * it chose, when it chose exactly one that is not the key), to be stored held and queued for a person.
 * Returns { items (the kept ones), held:[{ item, verdict, pick }], record: { status, checked, dropped, flagged:[{i, verdict}], model, cost_usd } }.
 */
async function verifyItems({ items, language = 'en', grade = null, subject = null, verify }) {
  const record = { status: 'skipped', checked: 0, dropped: 0, flagged: [], model: null, cost_usd: 0 };
  if (!items || !items.length) return { items: [], held: [], record };
  const FLAGGED = new Set(['disagree', 'ambiguous', 'none_correct']);
  const questions = items.map((it) => ({ question: it.question, options: it.options, correct_index: SLOTS.indexOf(it.correct) }));
  record.checked = items.length;
  const solve = (indices, again) => verify({ questions, indices, language, grade, subject, withLesson: false, again });
  try {
    const first = await solve(null, false);
    record.model = first.model || null;
    record.cost_usd += Number(first.costUsd) || 0;
    const verdicts = Array.isArray(first.verdicts) ? first.verdicts : [];
    const toConfirm = verdicts.filter((v) => v.verdict === 'disagree').map((v) => v.index);
    let confirmed = new Set();
    if (toConfirm.length) {
      const again = await solve(toConfirm, true);
      record.cost_usd += Number(again.costUsd) || 0;
      confirmed = new Set((again.verdicts || []).filter((v) => FLAGGED.has(v.verdict)).map((v) => v.index));
    }
    const out = new Set();
    const held = [];
    verdicts.forEach((v) => {
      if (FLAGGED.has(v.verdict) && (v.verdict !== 'disagree' || confirmed.has(v.index))) {
        out.add(v.index);
        record.flagged.push({ i: v.index, verdict: v.verdict });
        const it = items[v.index];
        const others = (Array.isArray(v.blind) ? v.blind : []).filter((k) => k !== SLOTS.indexOf(it.correct));
        held.push({ item: it, verdict: v.verdict, pick: others.length === 1 && SLOTS[others[0]] ? SLOTS[others[0]] : null });
      }
    });
    record.status = 'ok';
    record.dropped = out.size;
    record.cost_usd = Math.round(record.cost_usd * 1e6) / 1e6;
    return { items: items.filter((_, i) => !out.has(i)), held, record };
  } catch (err) {
    logToFile('⚠️ evening round: recall key solve failed — no rewrite is kept (fail-closed)', { error: String((err && err.message) || err).slice(0, 200) });
    record.status = 'error';
    record.dropped = items.length;
    record.cost_usd = Math.round(record.cost_usd * 1e6) / 1e6;
    return { items: [], held: [], record };
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
 * The quiz_questions rows for the rewritten pool. external_id `tq:<quizId>:recall:rc<rank>-<original 8>` is the bank's
 * `tq:<quizId>:<sloId>:<n>` shape (the order rule reads sort_order; the SLO segment reads 'recall') and carries the
 * round's quiz id because the column is unique across all quizzes: a class's rounds on two days running can recall
 * the same original at the same rank. The rows sort after the lesson items (sort_order 100 + rank).
 * media.round 'recall'; media.recall = { of, rank, kids (one-way keys of the children who missed it), chips (their
 * chips on this round's code, so the page's ?k= picks them without a read) }.
 * `held` (a rewrite the round's solve flagged): media.round 'held' (never served), media.key_held { reason
 * 'blind_solve', verdict, pick }, external_id `…:recall:h<n>-…`, sort_order 200 + n.
 */
function recallRows({ quizId, items, roundKey, chipOf = () => null, subject, held = false }) {
  return items.map((it, idx) => {
    const rank = idx + 1;
    const opts = it.options;
    let row = {
      quiz_id: quizId,
      external_id: `tq:${quizId}:recall:${held ? 'h' : 'rc'}${rank}-${String(it.original.question.id).slice(0, 8)}`,
      sort_order: (held ? 200 : 100) + rank,
      question_text: it.question,
      option_a: opts[0] || null, option_b: opts[1] || null, option_c: opts[2] || null, option_d: opts[3] || null,
      correct_option: it.correct,
      explanation: it.explanation,
      media: {
        round: held ? 'held' : 'recall',
        ...(held ? { key_held: { reason: 'blind_solve', verdict: it.verdict || null, pick: it.pick || null } } : {}),
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

// ── the answer-key review queue (quiz-key-review.service owns the table; the round only adds rows) ──────────

/**
 * Puts items on the review queue (quiz-key-review.service TABLE): one row per (item, reason) that is not there yet,
 * status 'open', first_flagged_on = last_seen_on = today's PKT date. A row already there, open or reviewed, is left
 * exactly as it is (a reviewer's verdict is never touched). Idempotent: a redelivered job adds nothing, and a
 * concurrent duplicate is the table's unique (question_id, reason), counted as there. An entry whose key is not one
 * A-D slot (a multi-answer or ordered item) cannot be queued (key_at_flag ~ '^[A-D]$') and is counted `skipped`.
 * NEVER throws: a failed write is logged and the item stays held.
 * @param {Array<{question_id, reason, key_at_flag, top_wrong_option?, answers_n?, top_wrong_n?, right_n?}>} entries
 * @returns {Promise<{queued:number, existing:number, skipped:number, failed:number}>}
 */
async function queueReview(entries, { now = new Date() } = {}) {
  const out = { queued: 0, existing: 0, skipped: 0, failed: 0 };
  let Keys = null;
  // eslint-disable-next-line global-require
  try { Keys = require('./quiz-key-review.service'); } catch (_) { Keys = null; }
  const list = (entries || []).filter((e) => e && e.question_id);
  const want = list.filter((e) => /^[A-D]$/.test(String(e.key_at_flag || '')) && Keys && Array.isArray(Keys.REASONS) && Keys.REASONS.includes(e.reason));
  out.skipped = list.length - want.length;
  if (!want.length) return out;
  try {
    const day = require('../nudges/pkt-time').pktDate(now);
    const there = new Set();
    for (const part of chunks([...new Set(want.map((e) => String(e.question_id)))])) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase.from('quiz_item_reviews').select('question_id, reason').in('question_id', part);
      if (error) throw new Error(error.message || 'review queue read failed');
      (data || []).forEach((r) => there.add(`${r.question_id}|${r.reason}`));
    }
    for (const e of want) {
      const k = `${e.question_id}|${e.reason}`;
      if (there.has(k)) { out.existing += 1; continue; }
      there.add(k);
      const top = /^[A-D]$/.test(String(e.top_wrong_option || '')) && e.top_wrong_option !== e.key_at_flag ? e.top_wrong_option : null;
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.from('quiz_item_reviews').insert({
        question_id: e.question_id, reason: e.reason, status: 'open', key_at_flag: e.key_at_flag, top_wrong_option: top,
        answers_n: Number(e.answers_n) || 0, top_wrong_n: Number(e.top_wrong_n) || 0, right_n: Number(e.right_n) || 0,
        first_flagged_on: day, last_seen_on: day,
      });
      if (!error) out.queued += 1;
      else if (error.code === '23505') out.existing += 1;
      else {
        out.failed += 1;
        logToFile('⚠️ evening round: one item not queued for review — it stays held', { reason: e.reason, error: error.message });
      }
    }
  } catch (err) {
    out.failed = want.length - out.queued - out.existing;
    logToFile('⚠️ evening round: review queue unwritable — the items stay held', { error: String((err && err.message) || err).slice(0, 200) });
  }
  return out;
}

/** The option slot of `text` on a stored row as the grader sees it (the web item's options when it has one), or null. */
function slotOfText(row, text) {
  const norm = (t) => String(t == null ? '' : t).replace(/[\u200E\u200F]/g, '').trim();
  const want = norm(text);
  if (!row || !want) return null;
  const w = row.media && row.media.web;
  const opts = w && Array.isArray(w.options)
    ? w.options.map((o) => [o && o.slot, o && o.text])
    : SLOTS.map((sl) => [sl, row[`option_${sl.toLowerCase()}`]]);
  const hit = opts.filter(([sl, t]) => t != null && norm(t) === want && /^[A-D]$/i.test(String(sl || '')));
  return hit.length === 1 ? String(hit[0][0]).toUpperCase() : null;
}

module.exports = {
  queueReview, slotOfText,
  POOL_MAX, KEY_HELD, missWindow, missesFor, rewrite, verifyItems, buildPrompt, checkItem, recallRows, isReadingItem, markReading, kidKey, heldIds, keyOf, pktMidnight,
};
