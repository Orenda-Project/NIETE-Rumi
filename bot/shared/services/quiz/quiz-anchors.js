'use strict';
/**
 * ANCHOR QUESTIONS (bd-chz35n.10.3) — a few FIXED questions per skill, asked again word for word in the
 * class's later quiz on the same skill, so "did this class get better on this skill?" is measured on the
 * same item. Before this, no question was ever re-asked (eval #228): the day-3 retest tells the author to
 * avoid every old question, and the evening round rewrites its recall items. Both stay as they are; this
 * only ADDS up to two verbatim questions to the retest, in its last slots, so the quiz keeps its length.
 *
 *   anchorsOn()                        app_settings `quiz_anchor_items`; only JSON true is on (60 s cache)
 *   itemKey(row)                       16-hex content key: stem + option texts + correct text(s), so a copy
 *                                      whose options sit under other letters is still the same item
 *   pickAnchors(rows, {max})           pure: up to `max` (2) plain questions, one per SLO first, quiz order;
 *                                      never a picture (its URL names the teacher), a 4th option or a pick-several
 *   carryRows(quizId, authored, anchors)  pure: authored rows minus any that repeat an anchor, cut so the
 *                                      anchors take the last slots; anchors copied column for column
 *   carry(quizId, rows, meta)          the generate step's call: anchors named in meta.anchor_from, switch on →
 *                                      { rows, keep, anchors }; anything else → the rows untouched. Never throws.
 *
 * Where it is recorded: the carrying quiz's meta.anchor_items [{ key, external_id, from_question_id }]. An
 * analysis joins quiz_answers → quiz_questions.external_id → that list, and compares on `key`. No schema change.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');

const FLAG_KEY = 'quiz_anchor_items';
const FLAG_TTL_MS = 60 * 1000;
const MAX_ANCHORS = 2;
const COPY_COLUMNS = [
  'question_text', 'option_a', 'option_b', 'option_c', 'correct_option', 'explanation', 'misconception_feedback',
  'distractor_misconceptions', 'option_feedback', 'difficulty_level', 'media', 'render_pattern',
];
const LETTERS = ['A', 'B', 'C', 'D'];

let flag = null;
async function anchorsOn() {
  if (flag && Date.now() - flag.at < FLAG_TTL_MS) return flag.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [FLAG_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === FLAG_KEY);
    flag = { at: Date.now(), on: Boolean(row) && row.value === true };
  } catch (e) {
    logToFile(`⚠️ ${FLAG_KEY}: settings lookup failed — anchor questions off`, { error: e.message });
    flag = { at: Date.now(), on: false };
  }
  return flag.on;
}

const norm = (s) => String(s == null ? '' : s).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const optionTexts = (row) => LETTERS.map((l) => row[`option_${l.toLowerCase()}`]).filter((t) => t != null && t !== '');

function itemKey(row) {
  const opts = LETTERS.map((l) => ({ l, t: row[`option_${l.toLowerCase()}`] })).filter((o) => o.t != null && o.t !== '');
  const correct = new Set(String(row.correct_option || '').split(',').map((s) => s.trim()));
  const body = JSON.stringify([
    norm(row.question_text),
    opts.map((o) => norm(o.t)).sort(),
    opts.filter((o) => correct.has(o.l)).map((o) => norm(o.t)).sort(),
  ]);
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
}

function sloOf(row) {
  const parts = String(row.external_id || '').split(':');
  return parts.length >= 4 ? parts[parts.length - 2] : 'S?';
}

const plain = (row) => !(row.media && row.media.question_image)
  && optionTexts(row).length === 3 && /^[ABC]$/.test(String(row.correct_option || '').trim());

function pickAnchors(rows, { max = MAX_ANCHORS } = {}) {
  const usable = (rows || []).filter(plain).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const out = [];
  const seen = new Set();
  usable.forEach((r) => { if (out.length < max && !seen.has(sloOf(r))) { seen.add(sloOf(r)); out.push(r); } });
  usable.forEach((r) => { if (out.length < max && !out.includes(r)) out.push(r); });
  return out;
}

function carryRows(quizId, authored, anchors) {
  if (!anchors || !anchors.length) return { rows: authored, keep: authored.map((_, i) => i), anchors: [] };
  // An exact copy of an anchor is always dropped. A question that only shares an anchor's stem (a generic
  // "Choose the correct answer" with other options) is used last, so the quiz still keeps its length.
  const stems = new Set(anchors.map((a) => norm(a.question_text)));
  const keys = new Set(anchors.map(itemKey));
  const idx = authored.map((_, i) => i).filter((i) => !keys.has(itemKey(authored[i])));
  const sameStem = (i) => stems.has(norm(authored[i].question_text));
  const keep = [...idx.filter((i) => !sameStem(i)), ...idx.filter(sameStem)]
    .slice(0, Math.max(0, authored.length - anchors.length)).sort((a, b) => a - b);
  const copies = anchors.map((a) => {
    const row = { quiz_id: quizId };
    COPY_COLUMNS.forEach((c) => { if (a[c] !== undefined && a[c] !== null) row[c] = a[c]; });
    return row;
  });
  const rows = [...keep.map((i) => ({ ...authored[i] })), ...copies].map((r, i) => {
    const slo = r.external_id ? sloOf(r) : sloOf(anchors[i - keep.length]);
    return { ...r, sort_order: i, external_id: `tq:${quizId}:${slo}:${i + 1}` };
  });
  const carried = rows.slice(keep.length).map((r, k) => ({
    key: itemKey(r), external_id: r.external_id, from_question_id: anchors[k].id,
  }));
  return { rows, keep, anchors: carried };
}

async function loadAnchorRows(ids) {
  const { data, error } = await supabase.from('quiz_questions')
    .select(['id', 'external_id', 'option_d', ...COPY_COLUMNS].join(', ')).in('id', ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data || []).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).filter(plain);
}

async function carry(quizId, rows, meta) {
  const ids = (meta && Array.isArray(meta.anchor_from) ? meta.anchor_from : []).filter(Boolean).slice(0, MAX_ANCHORS);
  const none = { rows, keep: rows.map((_, i) => i), anchors: null };
  if (!ids.length || !(await anchorsOn())) return none;
  try {
    const anchors = await loadAnchorRows(ids);
    if (!anchors.length) return { ...none, asked: ids.length };
    return { ...carryRows(quizId, rows, anchors), asked: ids.length };
  } catch (e) {
    logToFile('⚠️ anchor questions: the originals could not be read — the quiz ships as authored', { quizId, error: e.message });
    return { ...none, asked: ids.length };
  }
}

module.exports = {
  anchorsOn, itemKey, pickAnchors, carryRows, carry, FLAG_KEY, MAX_ANCHORS, _reset: () => { flag = null; },
};
