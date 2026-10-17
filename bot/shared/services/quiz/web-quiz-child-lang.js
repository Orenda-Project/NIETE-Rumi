'use strict';
/**
 * A child's language, in ONE order for every page and link (app_settings `web_quiz_return_lang`):
 *   a grown-up's choice → the page's own ?lang= → the newest class quiz's language (library lesson codes skipped) →
 *   the link's `l` → the language the child joined in → the newest library lesson's → none.
 * ladder() is that order over what the caller already holds; childLang(id) is it for a link (no ?lang=, no `l`, no
 * library lesson: a link never carries a lesson's language). The row is child-language.repo.js's. Off: the row is null
 * and nothing is read, so every caller's line is today's.
 */
const { logToFile } = require('../../utils/logger');
const R = require('./web-quiz-return-lang');
const Repo = require('./child-language.repo');

/**
 * The order itself. `own`: the child's child_language row ({ language, source }, null with the switch off); `asked`:
 * the page's ?lang= (en|ur, already checked); `history`: the child's quizzesForStudents() list; `linked`: the link's
 * `l`; `lessons: false` stops before the library lesson's language. → 'en' | 'ur' | null.
 */
function ladder({ own = null, asked = null, history = null, linked = null, lessons = true } = {}) {
  const SQ = require('./student-quiz.service');
  const kept = (s) => (own && own.source === s ? own.language : null);
  return kept('chosen') || asked || SQ.classLanguage(history) || linked || kept('join') || (lessons ? SQ.childLanguage(history) : null) || null;
}

/**
 * The child's kept row, by the id it is kept under: with `raw` (an id read from a quiz run or a link, which may be a
 * merged record) the id the child is known by under web_quiz_identity_canon. Switch off: null, nothing read.
 */
async function ownOf(studentId, { raw = false, memo = null } = {}) {
  const id = studentId ? String(studentId) : null;
  if (!id) return null;
  try {
    let key = id;
    if (raw && await R.on() && (await require('./web-quiz-identity-flags').flags()).canon) {
      key = String(await require('./web-quiz-identity-roster').canonicalStudentId(id));
    }
    return await Repo.stored(key, { memo });
  } catch (err) {
    logToFile('⚠️ child language: not read — none', { code: err.code || null });
    return null;
  }
}

/**
 * The language a link to this child's home carries: a grown-up's choice → the newest class quiz's → the join's → null.
 * `history`: the child's quizzesForStudents() list when the caller has read it (else it is read here, only when needed).
 * `raw`: the id may be a merged record (see ownOf).
 */
async function childLang(studentId, { history = null, memo = null, raw = false } = {}) {
  const id = studentId ? String(studentId) : null;
  if (!id) return null;
  const key = `l:${id}`;
  if (memo && memo.has(key)) return memo.get(key);
  let lang = null;
  try {
    const row = await ownOf(id, { raw, memo });
    if (row && row.source === 'chosen') lang = row.language;
    else if (await R.on()) {
      const SQ = require('./student-quiz.service');
      lang = ladder({ own: row, history: history || await SQ.quizzesForStudents([{ id }]), lessons: false });
    }
  } catch (err) {
    logToFile('⚠️ child language: not resolved — none', { code: err.code || null });
    lang = null;
  }
  if (memo) memo.set(key, lang);
  return lang;
}

module.exports = { childLang, ladder, ownOf };
