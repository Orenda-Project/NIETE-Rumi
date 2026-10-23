'use strict';
/**
 * When the engine stays silent (bd-8hhqhf R7b, COS ruling 20261023T144730 2a; panel ped/REVIEW_r7_scale.md §6.1). Pure.
 *
 * On the panel's 200 real picks the engine found the move when there was one and sent something anyway when there was
 * not. Four deterministic rules, each from the panel's rows:
 * - B6 (differentiation) with no visible mixed-level moment in the transcript → no move (P096, P099: 0 teacher-yes in 21);
 * - a 37-scheme subject label (F5 MATH, F6 SCIENCE, F7 LITERACY) on a lesson of another or unknown subject → no move
 *   (P066 ⛔4, P072, P076: all 16 F5 rows were F5 cards on non-maths lessons);
 * - a card sentence a teacher cannot do (no imperative: «Made one thing together», P123, P161) → no card fallback;
 * - a cited moment with no student turn on its line or the line either side → not a moment (P183, P076).
 */

// A visible mixed-level moment: a child not following, an early finisher, a task offered at two levels, a learner
// named as weaker or stronger. Content uses of the same words ("آسان کام ہے", "سمجھ نہیں آئیں گے") do not count.
const LEVELS = [
  /سمجھ نہیں (?:آیا|آئی|آ رہا|آ رہی)(?![ںے])/u,
  /\b(?:did ?n[o']?t|do ?n[o']?t|not) understand/i,
  /جن(?:ہوں)? نے (?:کام )?(?:ختم|مکمل) کر (?:لیا|لی)/u,
  /جو (?:بچے|بچیاں|طلبہ) (?:کام )?(?:ختم|مکمل)/u,
  /\b(?:who|if you) (?:has |have )?finish/i,
  /\bfinished early/i,
  /(?:آسان|مشکل) (?:سوال|والا|والی|ورژن)/u,
  /\b(?:easy|easier|difficult|hard|harder|challenge) (?:one|question|task|version)/i,
  /چیلنج/u,
  /ایکسٹرا (?:کام|سوال|ورک)/u,
  /\bextra (?:work|question|task)/i,
  /(?:کمزور|ہوشیار|ذہین|لائق) (?:بچ|طلب|طالب)/u,
  /\b(?:weak (?:student|one|learner)|slow learner|struggling)/i,
];

/** Some transcript line shows children at different levels (the B6 rule; 156-s2 / 157-s3's caveat). */
function levelsMoment(lines) {
  return (lines || []).some((l) => typeof l === 'string' && LEVELS.some((rx) => rx.test(l)));
}

// The 37 scheme's subject labels and the lessons they belong to (the shortlist's LABEL_SUBJECTS reads this one).
const LABEL_SUBJECTS = Object.freeze({ F5: ['maths'], F6: ['science'], F7: ['urdu', 'english', 'literacy'] });

/** A 37-scheme subject label whose subject is not the lesson's (an unknown subject included). `subject` is a subjectId. */
function labelOffSubject(scheme, indicator, subject) {
  const only = scheme === 'fico_main_37' ? LABEL_SUBJECTS[indicator] : null;
  return !!only && !only.includes(subject);
}

// The card's move: an English imperative verb, or an Urdu polite / familiar imperative. A diagnosis fragment has none.
const EN_DO = new Set(('ask add allow assign call check choose circulate cold-call collect count dedicate display divide do draw end '
  + 'explain give go have hold introduce invite keep let link list make mark model move name note offer pair pause plan point practise '
  + 'practice praise prepare provide put read record repeat replace run say set share show start stop summarise summarize swap tell '
  + 'think try turn use wait walk write').split(' '));
const UR_FORMS = ['\\S*(?:کریں|دیں|لیں|پوچھیں|کہیں|رکھیں|ائیں|لکھیں|پڑھیں|سنیں|دیکھیں|سوچیں|گنیں|بانٹیں)', // ائیں: بنائیں، آزمائیں، اپنائیں…
  // familiar, -یے polite, the impersonal «پوچھا جائے» and the verbal noun «مشق کروانا» a card also uses
  'کرو', 'کرواؤ', 'کراؤ', 'دو', 'لو', 'پوچھو', 'کہو', 'بتاؤ', 'دیکھو', 'لکھو', 'رکھو', 'سنو', 'جائے', 'پوچھیے', 'کیجیے', 'دیجیے', 'لیجیے', 'رکھیے', 'بتائیے',
  'دکھائیے', 'لکھیے', 'کرنا', 'کروانا', 'کرانا', 'دینا', 'لینا', 'پوچھنا', 'بتانا', 'دکھانا', 'لکھنا', 'رکھنا'];
const UR_DO = new RegExp(`(?:^|[\\s،؛,(«"'])(?:${UR_FORMS.join('|')})(?=$|[\\s،؛,.۔:)»"'!?؟])`, 'u');

/** The sentence asks the teacher to DO something (en or ur); a fragment like «Made one thing together» does not. */
function imperative(sentence) {
  const s = String(sentence || '');
  if (UR_DO.test(s)) return true;
  return s.toLowerCase().split(/[^a-z-]+/).some((w) => EN_DO.has(w));
}

const LABELLED = /^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*(?:teacher|students?|speaker)\b/i;
const KID = /^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*students?\b/i;

/**
 * The line at `i` or the line either side is a student turn. Lines without speaker labels are not judged (true).
 * @param {string[]} lines  excerpt or transcript lines "[mm:ss] Label: text"
 */
function childTurnNear(lines, i) {
  if (!Array.isArray(lines) || i < 0 || !lines.some((l) => LABELLED.test(String(l)))) return true;
  return [i - 1, i, i + 1].some((n) => n >= 0 && n < lines.length && KID.test(String(lines[n])));
}

module.exports = { levelsMoment, labelOffSubject, imperative, childTurnNear, LABEL_SUBJECTS };
