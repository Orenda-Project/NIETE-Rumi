'use strict';
/**
 * G5 Urdu Q10 letter and application (v37r4 g5-urdu): the rubric pays 3 marks for form items the model answer
 * lacked. The letter model had no date; the application opened «محترمہ!» with no عنوان line, no «جناب عالی!»
 * and no date. Added by code, in the standard Urdu form:
 *   - a letter with no date gets «تاریخ: ...» as its first line;
 *   - an application (it opens «بخدمت») gets «جناب عالی!» for the «محترمہ!» / «محترم!» salutation, an «عنوان:» line
 *     before it, and a closing «تاریخ:» line. The عنوان is named only for a leave application («رخصت کی درخواست»);
 *     for any other subject nothing is invented and the gap is noted, so the prompt's re-ask can fill it.
 * Pure: {examJson, notes}; the input is not changed.
 */

const { mapAll } = require('./fde-urdu-walk-all');

const SLOT = /^urdu\.C\.Q10$/;
const HAS_DATE = /تاریخ|[\d۰-۹]{4}/u;
const SALUTE = /^\s*(?:محترمہ|محترم|جناب\s*عالی|جنابِ\s*عالی)\s*[!！]/u;
const JANAB = /جناب\s*عالی|جنابِ\s*عالی/u;
// A model date in the paper's year. needs fluent-Urdu review
const DATE = 'تاریخ: ۱۵ مارچ ۲۰۲۶ء';

function mendApplication(answer, question, slot, notes) {
  const lines = String(answer).split('\n');
  let at = lines.findIndex((l) => SALUTE.test(l));
  if (at >= 0 && !JANAB.test(answer)) {
    lines[at] = 'جناب عالی!';
    notes.push(`${slot}: application salutation made «جناب عالی!» as the rubric names it`);
  }
  if (!/عنوان/.test(answer)) {
    if (/رخصت/.test(String(question || ''))) {
      lines.splice(at >= 0 ? at : Math.min(1, lines.length), 0, 'عنوان: رخصت کی درخواست'); // needs fluent-Urdu review
      notes.push(`${slot}: application عنوان line added`);
    } else {
      notes.push(`${slot}: the application has no عنوان line and its subject is not a leave request; the writer must supply one`);
    }
  }
  let text = lines.join('\n');
  if (!HAS_DATE.test(text)) { text = `${text}\n${DATE}`; notes.push(`${slot}: application date line added`); }
  return text;
}

function mendUrduForm(examJson) {
  const notes = [];
  const out = mapAll(examJson, (q) => {
    if (!SLOT.test(String(q.slot || '')) || typeof q.answer !== 'string' || !q.answer.trim()) return undefined;
    let answer = q.answer;
    if (/بخدمت/.test(answer)) answer = mendApplication(answer, q.question, q.slot, notes);
    else if (!HAS_DATE.test(answer)) { answer = `${DATE}\n${answer}`; notes.push(`${q.slot}: letter date line added`); }
    return answer === q.answer ? undefined : { ...q, answer };
  });
  return { examJson: out, notes };
}

module.exports = { mendUrduForm };
