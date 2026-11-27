'use strict';
/**
 * A TEACHER EDITS THEIR OWN LESSON QUIZ from the quiz page (/cq, /cr): a question's words, an option's words, which
 * option is right, or a question removed. Switch app_settings `web_quiz_teacher_edit` (missing row = off). The page
 * calls the portal, the portal checks the teacher and forwards here (/api/internal/wqedit, teacher-edit.mount.js).
 *
 * THE LOCK. /q reads a quiz's rows fresh on every load and grades each answer against the row as it is when the
 * answer lands (web-quiz.service loadQuestions, recordAnswers). So until a child has answered, anything may change.
 * Once one has, the words stay as the children read them: only the key may be corrected (it then grades the answers
 * still to come; answers already recorded keep their mark), and the feedback that explained the old key goes with
 * it. The rule is enforced in the save itself (quiz_teacher_edit_apply, one transaction that locks the question rows,
 * so a child's answer either is seen or waits), never only where the page draws.
 *
 * WHAT A SAVE WRITES. Both copies of the content: the columns (the PDF and WhatsApp read them) and media.web (the page
 * draws a v2 item from it). One audit row per changed field (quiz_teacher_edits: before/after, edited_by 'teacher').
 * On the quiz: edit_v + 1, the PDF key and the clip versions dropped, so the next Play records the changed words again
 * and no old PDF stays beside new questions. Then the PDF is remade under a new key (remakePdf); a render that fails
 * leaves no PDF ('pending'), and the hand-off's own absent-key path remakes it on the next resend or download.
 * A key fix after children answered also goes on the answer-key review queue as fixed (reason 'teacher_edit').
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const SWITCH_KEY = 'web_quiz_teacher_edit';
/** Code points, the way the page counts them. */
const TEXT_MAX = 400;
const OPTION_MAX = 150;
const OPS_MAX = 40;
const SLOTS = ['A', 'B', 'C', 'D'];
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The columns a save may write; the save checks each row still holds what the page drew, all of them. */
const EDIT_COLS = Object.freeze([
  'question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_option', 'explanation',
  'misconception_feedback', 'distractor_misconceptions', 'option_feedback', 'media',
]);
/** HTTP status for each refusal. */
const STATUS = Object.freeze({
  off: 404, not_found: 404, not_owner: 403, locked: 409, floor: 409, stale: 409,
  bad_request: 400, bad_qid: 400, bad_slot: 400, not_text: 400, not_editable: 400, too_long: 400, empty: 400, no_change: 400,
});

const minQuestions = () => require('./transcript-quiz-validator').MIN_QUESTIONS;
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const cp = (s) => [...s].length;
const colOf = (slot) => `option_${slot.toLowerCase()}`;
const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });

function editCols(row) {
  const out = {};
  EDIT_COLS.forEach((c) => { out[c] = row[c] === undefined ? null : clone(row[c]); });
  return out;
}

function webObj(media) {
  const w = media && media.web;
  return w && typeof w === 'object' && !Array.isArray(w) ? w : null;
}

/** Only one-or-more slots of A-D; ordered items (order, match) and figure match items keep their key. */
function keyEditable(row) {
  const w = webObj(row.media);
  if (w && (w.type === 'order' || w.type === 'match')) return false;
  if (!(w && w.v === 2)) {
    try { if (require('./web-quiz-figure').matchItem(row)) return false; } catch (_) { /* not a figure item */ }
  }
  return true;
}

function optionIsPicture(row, slot) {
  const i = SLOTS.indexOf(slot);
  const m = row.media || {};
  if (Array.isArray(m.option_images) && m.option_images[i]) return true;
  const w = webObj(m);
  const o = w && Array.isArray(w.options) ? w.options.find((x) => x && x.slot === slot) : null;
  return Boolean(o && o.pic);
}

function cleanText(raw) {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim();
}

function keyOfRow(row) {
  const w = webObj(row.media);
  const k = w && w.key ? w.key : row.correct_option;
  return String(k || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean).sort().join(',');
}

/** The key's explanation and feedback name the old answer: a key fix clears them, so nothing explains a wrong key. */
function clearFeedback(after) {
  after.explanation = null;
  after.misconception_feedback = null;
  after.distractor_misconceptions = null;
  after.option_feedback = null;
  const w = webObj(after.media);
  if (w) {
    delete w.why;
    delete w.fb_right;
    if (Array.isArray(w.options)) w.options.forEach((o) => { if (o && typeof o === 'object') delete o.fb; });
  }
}

/**
 * The save's changes from the page's ops, against the rows as read. Pure.
 * ops: [{op:'text'|'option'|'key'|'remove', qid, slot?, text?}]
 * → {ok:true, changes:[{id, remove, before, after, fields:[{field, before, after}]}]} | {ok:false, reason, qid?}
 * Each audit `before` carries the whole row as it was ({value, row}), so the revert script restores it exactly.
 */
function plan(rows, ops) {
  if (!Array.isArray(rows) || !rows.length) return refuse('not_found');
  if (!Array.isArray(ops) || !ops.length || ops.length > OPS_MAX) return refuse('bad_request');
  // An evening round's rows are copies the round owns: a teacher edits the lesson quiz, never a round.
  if (rows.some((r) => r && r.media && (r.media.round != null || r.media.round_key != null))) return refuse('not_editable');
  const byId = new Map(rows.map((r) => [r.id, r]));
  const work = new Map();
  const slot = (id) => {
    if (!work.has(id)) {
      const row = byId.get(id);
      work.set(id, { row, before: editCols(row), after: editCols(row), fields: [], remove: false });
    }
    return work.get(id);
  };
  for (const op of ops) {
    if (!op || typeof op !== 'object') return refuse('bad_request');
    const qid = typeof op.qid === 'string' ? op.qid : null;
    if (!qid || !byId.has(qid)) return refuse('bad_qid', { qid });
    const w = slot(qid);
    const { row, after } = w;
    if (op.op === 'remove') { w.remove = true; continue; }
    if (op.op === 'text') {
      const t = cleanText(op.text);
      if (!t) return refuse('empty', { qid });
      if (cp(t) > TEXT_MAX) return refuse('too_long', { qid, max: TEXT_MAX });
      if (t === after.question_text) continue;
      w.fields.push({ field: 'text', before: after.question_text, after: t });
      after.question_text = t;
      const web = webObj(after.media);
      if (web && web.stem != null) web.stem = t;
      continue;
    }
    if (op.op === 'option') {
      const s = typeof op.slot === 'string' ? op.slot.toUpperCase() : '';
      if (!SLOTS.includes(s) || row[colOf(s)] == null) return refuse('bad_slot', { qid });
      if (optionIsPicture(row, s)) return refuse('not_text', { qid });
      const t = cleanText(op.text);
      if (!t) return refuse('empty', { qid });
      if (cp(t) > OPTION_MAX) return refuse('too_long', { qid, max: OPTION_MAX });
      if (t === after[colOf(s)]) continue;
      w.fields.push({ field: colOf(s), before: after[colOf(s)], after: t });
      after[colOf(s)] = t;
      const web = webObj(after.media);
      const o = web && Array.isArray(web.options) ? web.options.find((x) => x && x.slot === s) : null;
      if (o) { o.text = t; delete o.fb; }
      // The stored feedback for this option described the old words.
      const fb = after.option_feedback;
      const i = String(SLOTS.indexOf(s));
      if (fb && typeof fb === 'object' && fb.wrong && typeof fb.wrong === 'object' && i in fb.wrong) delete fb.wrong[i];
      continue;
    }
    if (op.op === 'key') {
      if (!keyEditable(row)) return refuse('not_editable', { qid });
      const raw = typeof op.slot === 'string' ? op.slot.toUpperCase() : '';
      const slots = [...new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))].sort();
      const web = webObj(after.media);
      const multi = Boolean(web && web.type === 'multi');
      if (!slots.length || slots.some((x) => !SLOTS.includes(x) || row[colOf(x)] == null) || (slots.length > 1 && !multi)) {
        return refuse('bad_slot', { qid });
      }
      const next = slots.join(',');
      const was = keyOfRow({ media: after.media, correct_option: after.correct_option });
      if (next === was) continue;
      w.fields.push({ field: 'key', before: was, after: next });
      after.correct_option = next;
      if (web && web.key != null) web.key = next;
      clearFeedback(after);
      continue;
    }
    return refuse('bad_request', { qid });
  }
  const changes = [];
  for (const [id, w] of work) {
    if (w.remove) {
      changes.push({
        id, remove: true, before: w.before, after: w.before,
        fields: [{ field: 'remove', before: { value: w.row.question_text, row: clone(w.row) }, after: null }],
      });
    } else if (w.fields.length) {
      changes.push({
        id, remove: false, before: w.before, after: w.after,
        fields: w.fields.map((f) => ({ field: f.field, before: { value: f.before, row: w.before }, after: { value: f.after } })),
      });
    }
  }
  return changes.length ? { ok: true, changes } : refuse('no_change');
}

async function switchOn(db = supabase) {
  try {
    const { data, error } = await db.from('app_settings').select('value').eq('key', SWITCH_KEY).maybeSingle();
    if (error || !data) return false;
    const v = data.value;
    return v === true || v === 'true' || (v && typeof v === 'object' && v.on === true);
  } catch (_) {
    return false;
  }
}

async function readRows(quizId, db = supabase) {
  const { data, error } = await db.from('quiz_questions').select('*').eq('quiz_id', quizId).order('sort_order', { ascending: true });
  if (error) throw new Error(`quiz_questions read failed: ${error.message}`);
  return data || [];
}

/**
 * Has a child answered this quiz (any of its links)? Any sitting but the teacher's own preview (user_id = the quiz's
 * teacher) counts. Advisory for the page; the save checks again under its lock.
 */
async function childAnswered(quizId, teacherId, db = supabase) {
  const { data: sessions, error } = await db.from('quiz_sessions').select('id').eq('quiz_id', quizId)
    .or(`user_id.is.null,user_id.neq.${teacherId}`).limit(1000);
  if (error) throw new Error(`quiz_sessions read failed: ${error.message}`);
  const ids = (sessions || []).map((s) => s.id);
  for (let i = 0; i < ids.length; i += 200) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error: e } = await db.from('quiz_answers').select('id').in('session_id', ids.slice(i, i + 200)).limit(1);
    if (e) throw new Error(`quiz_answers read failed: ${e.message}`);
    if (data && data.length) return true;
  }
  return false;
}

/**
 * The PDF for this edit version, under its own key; meta.pdf_key is set only while edit_v is still this one (a later
 * save wins). The render is the hand-off's: its load() and the generator's renderPdf with the arguments the hand-off
 * passes. → 'ready' | 'pending' (failed, or a later save superseded it).
 */
async function remakePdf(quizId, editV, deps = {}) {
  const db = deps.db || supabase;
  try {
    const Handoff = deps.handoff || require('./transcript-quiz-handoff.service');
    const Gen = deps.gen || require('./transcript-quiz-generate.service');
    const upload = deps.upload || require('../../storage/r2').uploadBuffer;
    const { formatLessonDate } = require('./transcript-quiz-language');
    const b = await Handoff.load(quizId);
    if (!b) return 'pending';
    const meta = b.meta || {};
    const buffer = await Gen.renderPdf({
      quiz: b.quiz, questions: Gen.withFigureSvgs(b.qRows, b.questions, b.language), digest: b.digest, teacherName: b.teacherName,
      grade: b.quiz.grade || meta.grade || null,
      lessonSummary: meta.lesson_summary_short || meta.lesson_summary || '',
      language: b.language, contentLanguage: b.language,
      date: formatLessonDate((b.session || {}).created_at, b.language, { year: true }), link: meta.link || null,
    });
    const key = `transcript_quizzes/${b.quiz.teacher_id}/${quizId}-e${editV}.pdf`;
    await upload(buffer, key, 'application/pdf');
    const { data, error } = await db.rpc('quiz_teacher_edit_pdf', { p_quiz_id: quizId, p_edit_v: editV, p_pdf_key: key });
    if (error) throw new Error(error.message);
    return data === true ? 'ready' : 'pending';
  } catch (err) {
    logToFile('⚠️ teacher quiz edit: PDF not remade (the next resend or download remakes it)', { quizId, editV, error: err.message }, 'warn');
    logEvent('transcript_quiz.page_edit_pdf_failed', { quiz_id: quizId, edit_v: editV });
    return 'pending';
  }
}

const out = (status, body) => ({ status, body });
const refusal = (reason, extra = {}) => out(STATUS[reason] || 400, { ok: false, reason, ...extra });

/**
 * The save. body: {quizId, teacherUserId, v?, ops, surface?} → {status, body}
 * 200 {ok, edit_v, n, answered, pdf} | 409 locked/floor/stale | 400 the op's reason | 403 not_owner | 404 off/not_found
 */
async function save(body = {}, deps = {}) {
  const db = deps.db || supabase;
  if (!(await switchOn(db))) return out(404, { off: true });
  const { quizId, teacherUserId, ops } = body || {};
  if (!UUID_RX.test(String(quizId || '')) || !UUID_RX.test(String(teacherUserId || ''))) return refusal('bad_request');
  const v = Number.isInteger(body.v) && body.v >= 0 ? body.v : null;
  const surface = body.surface === 'cr' ? 'cr' : 'cq';
  const rows = await readRows(quizId, db);
  const p = plan(rows, ops);
  if (!p.ok) {
    if (p.reason === 'not_found') return refusal('not_found');
    return refusal(p.reason, p.qid ? { qid: p.qid, ...(p.max ? { max: p.max } : {}) } : {});
  }
  const { data, error } = await db.rpc('quiz_teacher_edit_apply', {
    p_quiz_id: quizId, p_teacher_id: teacherUserId, p_expect_v: v, p_changes: p.changes, p_min: minQuestions(), p_editor: 'teacher',
  });
  if (error) {
    logToFile('❌ teacher quiz edit: save failed', { quizId, error: error.message }, 'error');
    return out(502, { ok: false, reason: 'db_unavailable' });
  }
  const r = data || {};
  const fields = p.changes.flatMap((c) => c.fields.map((f) => f.field));
  if (!r.ok) {
    if (r.reason === 'locked') fields.forEach((field) => logEvent('transcript_quiz.page_edit', { quiz_id: quizId, field, locked: true, surface }));
    return refusal(r.reason || 'bad_request', {
      ...(r.qid ? { qid: r.qid } : {}), ...(r.edit_v != null ? { edit_v: r.edit_v } : {}), ...(r.min != null ? { min: r.min } : {}),
    });
  }
  fields.forEach((field) => logEvent('transcript_quiz.page_edit', {
    quiz_id: quizId, field, locked: false, answered: Boolean(r.answered), edit_v: r.edit_v, surface,
  }));
  const pdf = await (deps.remakePdf || remakePdf)(quizId, r.edit_v, deps);
  return out(200, { ok: true, edit_v: r.edit_v, n: r.n, answered: Boolean(r.answered), pdf });
}

function viewItem(row, locked) {
  const w = webObj(row.media);
  const options = SLOTS.filter((s) => row[colOf(s)] != null).map((s) => {
    const o = w && Array.isArray(w.options) ? w.options.find((x) => x && x.slot === s) : null;
    return { slot: s, text: (o && o.text) || row[colOf(s)], picture: optionIsPicture(row, s) };
  });
  const keyOk = keyEditable(row);
  return {
    qid: row.id,
    text: (w && w.stem) || row.question_text,
    options,
    key: keyOfRow(row),
    multi: Boolean(w && w.type === 'multi'),
    editable: { text: !locked, options: !locked, key: keyOk, remove: !locked },
  };
}

/** The view: every question with its key, the lock and the PDF state. {status, body} like save. */
async function view({ quizId, teacherUserId } = {}, deps = {}) {
  const db = deps.db || supabase;
  if (!(await switchOn(db))) return out(404, { off: true });
  if (!UUID_RX.test(String(quizId || '')) || !UUID_RX.test(String(teacherUserId || ''))) return refusal('bad_request');
  const { data: quiz, error } = await db.from('quizzes').select('id, teacher_id, language, meta').eq('id', quizId).maybeSingle();
  if (error) return out(502, { ok: false, reason: 'db_unavailable' });
  if (!quiz) return refusal('not_found');
  if (quiz.teacher_id !== teacherUserId) return refusal('not_owner');
  const rows = await readRows(quizId, db);
  const round = rows.some((r) => r && r.media && (r.media.round != null || r.media.round_key != null));
  const locked = await childAnswered(quizId, quiz.teacher_id, db);
  const meta = quiz.meta || {};
  return out(200, {
    ok: true,
    quiz_id: quizId,
    language: quiz.language,
    edit_v: Number(meta.edit_v) || 0,
    locked,
    editable: !round,
    n: rows.length,
    min: minQuestions(),
    pdf: meta.pdf_key ? 'ready' : 'pending',
    pdf_key: meta.pdf_key || null,
    questions: rows.map((r) => viewItem(r, locked || round)),
  });
}

/** Make sure the quiz has a PDF for its current version (Download on a 'pending' quiz). */
async function ensurePdf({ quizId, teacherUserId } = {}, deps = {}) {
  const db = deps.db || supabase;
  if (!(await switchOn(db))) return out(404, { off: true });
  if (!UUID_RX.test(String(quizId || '')) || !UUID_RX.test(String(teacherUserId || ''))) return refusal('bad_request');
  const { data: quiz, error } = await db.from('quizzes').select('id, teacher_id, meta').eq('id', quizId).maybeSingle();
  if (error) return out(502, { ok: false, reason: 'db_unavailable' });
  if (!quiz) return refusal('not_found');
  if (quiz.teacher_id !== teacherUserId) return refusal('not_owner');
  const meta = quiz.meta || {};
  if (meta.pdf_key) return out(200, { ok: true, pdf: 'ready', pdf_key: meta.pdf_key });
  const editV = Number(meta.edit_v) || 0;
  const pdf = await (deps.remakePdf || remakePdf)(quizId, editV, deps);
  return out(200, { ok: true, pdf });
}

module.exports = {
  plan, save, view, ensurePdf, remakePdf, switchOn, childAnswered, editCols,
  SWITCH_KEY, EDIT_COLS, TEXT_MAX, OPTION_MAX, STATUS,
};
