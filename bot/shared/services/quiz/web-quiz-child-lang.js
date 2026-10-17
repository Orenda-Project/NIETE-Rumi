'use strict';
/**
 * The language a link to a child's home carries (app_settings `web_quiz_return_lang`): a grown-up's choice → the
 * newest class quiz's language (library lesson codes skipped) → the language the child joined in → null. The row is
 * child-language.repo.js's; the order is the one every link and page uses (see there). Off: null, nothing read.
 */
const { logToFile } = require('../../utils/logger');
const R = require('./web-quiz-return-lang');
const Repo = require('./child-language.repo');

/**
 * The language a link to this child's home carries: a grown-up's choice → the newest class quiz's → the join's → null.
 * `history`: the child's quizzesForStudents() list when the caller has read it (else it is read here, only when needed).
 */
async function childLang(studentId, { history = null, memo = null } = {}) {
  const id = studentId ? String(studentId) : null;
  if (!id) return null;
  const key = `l:${id}`;
  if (memo && memo.has(key)) return memo.get(key);
  let lang = null;
  try {
    const row = await Repo.stored(id, { memo });
    if (row && row.source === 'chosen') lang = row.language;
    else if (await R.on()) {
      const SQ = require('./student-quiz.service');
      // the newest class quiz's language (StudentQuiz.classLanguage: library lesson codes skipped)
      lang = SQ.classLanguage(history || await SQ.quizzesForStudents([{ id }])) || (row ? row.language : null);
    }
  } catch (err) {
    logToFile('⚠️ child language: not resolved — none', { code: err.code || null });
    lang = null;
  }
  if (memo) memo.set(key, lang);
  return lang;
}

module.exports = { childLang };
