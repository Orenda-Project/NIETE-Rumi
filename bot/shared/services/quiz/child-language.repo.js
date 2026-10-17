'use strict';
/**
 * A child's own language, kept on one row per child (child_language) under app_settings `web_quiz_return_lang`, the
 * same switch as the /quiz reply's link: "the child's language follows the child". Two writes: the join's language
 * ('join', once, when a child joins on their own) and a grown-up's tap on the home's grown-ups corner ('chosen', the
 * only update). The order every link and page uses (web-quiz-child-lang.js ladder()):
 *   a grown-up's choice → the page's own ?lang= → the newest class quiz's language → the link's `l` → the join's →
 *   the newest library lesson's → English.
 * stored(id) hands a child's row to ladder(); web-quiz-child-lang.js childLang(id) answers it for a link. Off, or any read error: null, and nothing is read or written. Logs carry an error code
 * only: never an id, a name or a phone.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const R = require('./web-quiz-return-lang');

const TABLE = 'child_language';

const clean = (row) => (row && R.linkLang(row.language) && (row.source === 'join' || row.source === 'chosen')
  ? { language: row.language, source: row.source } : null);

/** The children's rows, by id (switch already known on). Never throws: {} on any error. */
async function readRows(ids) {
  try {
    const { data, error } = await supabase.from(TABLE).select('canonical_id, language, source').in('canonical_id', ids);
    if (error) throw Object.assign(new Error(error.message || 'child_language read failed'), { code: error.code });
    const out = {};
    (data || []).forEach((r) => { const c = clean(r); if (c) out[String(r.canonical_id)] = c; });
    return out;
  } catch (err) {
    logToFile('⚠️ child language: not read — none', { code: err.code || null });
    return {};
  }
}

/** `{ language, source }` for this child, or null (switch off, no row, an error). `memo`: a Map kept for one request. */
async function stored(studentId, { memo = null } = {}) {
  const id = studentId ? String(studentId) : null;
  if (!id) return null;
  const key = `s:${id}`;
  if (memo && memo.has(key)) return memo.get(key);
  let row = null;
  try {
    if (await R.on()) row = (await readRows([id]))[id] || null;
  } catch (_) { row = null; }
  if (memo) memo.set(key, row);
  return row;
}

/** The first of these children with a grown-up's choice: its language, else null (switch off: null, nothing read). */
async function chosenOf(studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean).map(String))];
  if (!ids.length) return null;
  try {
    if (!(await R.on())) return null;
    const rows = await readRows(ids);
    const hit = ids.map((id) => rows[id]).find((r) => r && r.source === 'chosen');
    return hit ? hit.language : null;
  } catch (_) {
    return null;
  }
}

/** The join: the language a child joined in, once (an existing row is never changed). Switch decided by the caller. */
async function joined(canonicalId, language) {
  if (!canonicalId || !R.linkLang(language)) return false;
  try {
    const { error } = await supabase.from(TABLE).insert({ canonical_id: String(canonicalId), language, source: 'join' });
    if (error && error.code !== '23505') throw Object.assign(new Error(error.message || 'insert failed'), { code: error.code });
    return !error;
  } catch (err) {
    logToFile('⚠️ child language: the joined language was not kept (the join goes on)', { code: err.code || null });
    return false;
  }
}

/** A grown-up's tap on the grown-ups corner: this child's language from now on. Only with the switch on. */
async function choose(canonicalId, language) {
  if (!canonicalId || !R.linkLang(language)) return false;
  try {
    if (!(await R.on())) return false;
    const { error } = await supabase.from(TABLE)
      .upsert({ canonical_id: String(canonicalId), language, source: 'chosen', set_at: new Date().toISOString() }, { onConflict: 'canonical_id' });
    if (error) throw Object.assign(new Error(error.message || 'upsert failed'), { code: error.code });
    return true;
  } catch (err) {
    logToFile('⚠️ child language: the grown-up\'s choice was not kept', { code: err.code || null });
    return false;
  }
}

module.exports = { stored, chosenOf, joined, choose, TABLE };
