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
 * R7c (COS 20261023T170515 §2, panel Q194): a transcript that is mostly a recogniser loop has no moments at all.
 */

// A visible mixed-level moment: a child not following, an early finisher, a task offered at two levels, a learner
// named as weaker or stronger. Content uses of the same words ("آسان کام ہے", "سمجھ نہیں آئیں گے") do not count.
const LEVELS = [
  /سمجھ (?:میں )?نہیں (?:آیا|آئی|آ ?رہا|آ ?رہی)(?![ںے])/u,
  /\bsamajh nahi?n? (?:aya|ayi|aa? ?raha|aa? ?rahi)\b/i,
  /\b(?:confused|could ?n.t do it|fast finishers?|(?:those|who) (?:are|is) (?:done|finished))\b/i,
  /پیچھے رہ (?:گئے|گیا|گئی)|دوبارہ سمجھاؤں/u,
  /جو (?:بچے |بچیاں |طلبہ )?پہلے (?:ختم|مکمل)/u,
  /\b(?:did ?n[o']?t|do ?n[o']?t|not) understand/i,
  /جن(?:ہوں)? نے (?:کام )?(?:(?:ختم|مکمل) )?کر (?:لیا|لی)/u,
  /جو (?:بچے|بچیاں|طلبہ) (?:کام )?(?:ختم|مکمل)/u,
  /\b(?:who|if you) (?:has |have )?finish/i,
  /\bfinished early/i,
  /(?:آسان|مشکل) (?:سوال|والا|والی|ورژن)/u,
  /\b(?:easy|easier|difficult|hard|harder|challenge) (?:one|question|task|version)/i,
  /چیلنج (?:والا|والی|والے|سوال|ٹاسک|ورژن|کام)/u, // red7 F1: «زندگی میں ہر چیلنج» is not a task level
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
// red7 F2: no "do" ("Students do not understand" is a diagnosis); "Don't …" counts by its own rule below.
const EN_DO = new Set(('ask add allow assign begin call check choose circulate clap cold-call collect count dedicate display divide draw encourage end '
  + 'explain give go have help hold introduce invite keep let link list make mark model move name nominate note offer pair pause plan point practise '
  + 'practice praise prepare provide put re-teach read record remind repeat replace reteach rotate run say set share show signal speak start stop '
  + 'summarise summarize swap tell think try turn use wait walk write').split(' '));
const EN_DONT = /(?:^|[.;:,]\s*)(?:don['’]?t|never|avoid)\s/i;
const UR_FORMS = ['\\S*(?:کریں|دیں|لیں|پوچھیں|کہیں|رکھیں|ائیں|لکھیں|پڑھیں|سنیں|دیکھیں|سوچیں|گنیں|بانٹیں)', // ائیں: بنائیں، آزمائیں، اپنائیں…
  // familiar, -یے polite, the impersonal «پوچھا جائے» and the verbal noun «مشق کروانا» a card also uses
  'کرو', 'کرواؤ', 'کراؤ', 'دو', 'لو', 'پوچھو', 'کہو', 'بتاؤ', 'دیکھو', 'لکھو', 'رکھو', 'سنو', 'جائے', 'پوچھیے', 'کیجیے', 'دیجیے', 'لیجیے', 'رکھیے', 'بتائیے',
  'دکھائیے', 'لکھیے', 'چلیں', 'بیٹھیں', 'ٹوکیں', 'بولیں', 'روکیں', 'سمجھیں', 'جوڑیں', 'کرنا', 'کروانا', 'کرانا', 'دینا', 'لینا', 'پوچھنا', 'بتانا', 'دکھانا', 'لکھنا', 'رکھنا'];
const UR_DO = new RegExp(`(?:^|[\\s،؛,(«"'])(?:${UR_FORMS.join('|')})(?=$|[\\s،؛,.۔:)»"'!?؟])`, 'u');

/** The sentence asks the teacher to DO something (en or ur); a fragment like «Made one thing together» does not. */
function imperative(sentence) {
  const s = String(sentence || '');
  if (UR_DO.test(s) || EN_DONT.test(s)) return true;
  return s.toLowerCase().split(/[^a-z-]+/).some((w) => EN_DO.has(w));
}

// red7 F3: any labelled turn that is not the teacher's is a child's («Student 2», «Class», «طالب علم», «Speaker 2»).
const LABELLED = /^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*[^:\n]{1,30}:/;
const TEACHER_LABEL = /^\s*\[\d{1,2}:\d{2}(?::\d{2})?\]\s*(?:teacher|coach|استاد|استانی|ٹیچر|speaker\s*1\b)/i;
const KID = { test: (l) => LABELLED.test(l) && !TEACHER_LABEL.test(l) };

/**
 * The line at `i` or the line either side is a child's turn (any labelled turn but the teacher's). Lines without speaker
 * labels are not judged (true).
 * @param {string[]} lines  excerpt or transcript lines "[mm:ss] Label: text"
 */
function childTurnNear(lines, i) {
  if (!Array.isArray(lines) || i < 0 || !lines.some((l) => LABELLED.test(String(l)))) return true;
  return [i - 1, i, i + 1].some((n) => n >= 0 && n < lines.length && KID.test(String(lines[n])));
}

// R7c (Q194): Soniox can loop one phrase for minutes («… کیسے بچا جائے» ×5, then a two-word loop ×90); the engine quoted
// the loop as the teacher's question. A loop is a unit of 1–8 words said 3+ times back to back. Measured on the 3,000 r7
// transcripts: ≥ 50% of the words inside loops flags 10 (Q194 at 85%); a times-table drill, where each line is said
// twice, is not a loop (28% distinct 4-grams, 0% in loops). Speaker labels and stamps are not words; under 20 words is
// not judged (an empty or short transcript has its own rules).
const LOOP_SHARE = 0.5;
const MIN_LOOP_WORDS = 20;

/** The share of words inside back-to-back loops. */
function loopShare(words) {
  const cov = new Uint8Array(words.length);
  const same = (a, b, p) => { for (let k = 0; k < p; k++) if (words[a + k] !== words[b + k]) return false; return true; };
  for (let i = 0; i < words.length; i++) {
    for (let p = 1; p <= 8 && i + 3 * p <= words.length; p++) {
      if (!same(i, i + p, p) || !same(i, i + 2 * p, p)) continue;
      let end = i + 3 * p;
      while (end + p <= words.length && same(i, end, p)) end += p;
      cov.fill(1, i, end);
      break;
    }
  }
  return words.length ? cov.reduce((a, b) => a + b, 0) / words.length : 0;
}

/** The transcript lines are mostly a recogniser loop (or placeholders): no line of it is a moment. */
function degenerate(lines) {
  const text = (lines || []).map((l) => String(l || '').replace(/^\s*\[[\d:]+\]\s*[^:\n]{0,30}:\s*/, '')).join(' ');
  const words = text.match(/\[[^\]\s]+(?: [^\]\s]+)?\]|[\p{L}\p{N}]+/gu) || [];
  if (words.length < MIN_LOOP_WORDS) return false;
  const placeholders = words.filter((w) => w.startsWith('[')).length / words.length;
  return placeholders >= LOOP_SHARE || loopShare(words) >= LOOP_SHARE;
}

// R7c (COS 20261023T170515 §3; panel Q031 Q061 Q063 Q072 Q084 Q170 Q179 Q187 Q198 Q028): a line that only greets, calls a
// page, gives an order about the room or announces the lesson is not a teaching moment, however the model reads it.
// Sentence by sentence; the quote is no moment when ≥ 60% of its words are in such sentences, so a real question after
// an announcement still is one («Today we learn fractions. Who can tell me why half is bigger than a quarter?»).
const ROUTINE = [
  // greeting
  /السلام علیکم|وعلیکم السلام|\bassalam|\bgood (?:morning|afternoon)\b|\bhow are you\b|آپ کیسے ہیں|\bhello\b/iu,
  // page or book call
  /(?:پیج|صفحہ|صفحے)\s*(?:نمبر)?\s*[\d۰-۹]|\bpage\s*(?:no\.?|number)?\s*\d|\bopen your (?:book|copy|notebook)|(?:کتاب|کتابیں|کاپی|کاپیاں)\s+(?:کھول|نکال)|چیپٹر نمبر/iu,
  // order about the room
  /بیٹھ (?:جاؤ|جائیں|جاو)|\bsit down\b|خاموش (?:ہو|رہ)|\bbe quiet\b|\bsilence please\b|لائن (?:بنا|میں)|\bstand up\b|کھڑے ہو (?:جاؤ|جائیں)/iu,
  // announcing the lesson or what will happen in it
  /^(?=.*آج)(?=.*(?:ٹاپک|سبق|موضوع|لیسن|پڑھائی))|(?:ٹاپک|سبق|موضوع) (?:ہے|کون سا ہے|کیا ہے)|\b(?:today|now) we (?:will|are going to|shall)\b|\b(?:our|today'?s) (?:topic|lesson) is\b|\btopic is\b|ہم (?:\S+\s+){0,3}(?:پڑھیں|سیکھیں|بنائیں|دیکھیں|لکھیں|سنیں|شروع کریں|کریں) گے|(?:میں|ہم) نے (?:\S+\s+){0,8}(?:کرنا|کرنے|پڑھنا|پڑھنے|کروانا|کروانے|سیکھنا|سیکھنے) (?:ہے|ہیں)/iu,
];
const ROUTINE_SHARE = 0.6;
// …but an announcement is a statement: a sentence that asks («ہم نے کس چیز کو سرکل کرنا ہے؟», Q135; «تو سب سے پہلے ہم کیا
// کریں گے؟», Q069), or asks why or how, is a question about the lesson
// a tag question («…، ٹھیک ہے؟», Q063) does not make a statement a question
const TAG_QUESTION = /[،,]?\s*(?:ٹھیک ہے|ہے نا|نا|okay|ok|right)\s*[?؟]\s*$/iu;
const WHY_HOW = /کیوں|کیسے|\bwhy\b|\bhow\b(?! are you)/iu;
const isRoutine = (x) => ROUTINE.slice(0, 3).some((rx) => rx.test(x)) || (ROUTINE[3].test(x) && !WHY_HOW.test(x) && !/[?؟]/.test(x.replace(TAG_QUESTION, '')));

/** The quoted line only greets, calls a page, orders the room or announces the lesson. */
function routineLine(quote) {
  const sentences = String(quote || '').split(/(?<=[.!?۔؟])\s+|\s*—\s*/u).filter((x) => /[\p{L}\p{N}]/u.test(x));
  const words = (x) => (x.match(/[\p{L}\p{N}]+/gu) || []).length;
  const all = sentences.reduce((n, x) => n + words(x), 0);
  if (!all) return false;
  const routine = sentences.filter(isRoutine).reduce((n, x) => n + words(x), 0);
  return routine / all >= ROUTINE_SHARE;
}

// R7c (COS 20261023T170515 §4; panel: 51-s3 sent 11 times, 0 right): a lesson whose children answer in a word or a chorus.
// Of the labelled child turns, ≥ 60% are ≤ 3 words and at most one in twenty gives a reason (Q121: 155 of 165 short, 3
// reasons). Unlabelled transcripts are not judged.
const CLOSED_SHARE = 0.6;
const REASON = /کیونکہ|کیوں کہ|اس لیے|\bbecause\b/iu;

/** The lesson's child turns are closed or chorus answers (false when there are fewer than 3 labelled child turns). */
function closedAnswers(lines) {
  const kids = (lines || []).map(String).filter((l) => KID.test(l)).map((l) => l.replace(LABELLED, ''));
  if (kids.length < 3) return false;
  const short = kids.filter((k) => (k.match(/[\p{L}\p{N}]+/gu) || []).length <= 3).length;
  return short / kids.length >= CLOSED_SHARE && kids.filter((k) => REASON.test(k)).length <= Math.max(1, kids.length * 0.05);
}

// The card asks for a why/how or open question.
const WHY_CARD = /کیوں|کیسے|\bwhy\b|\bhow\b|open[- ]ended|open questions?|کھلے سوال|کھلا سوال|اوپن اینڈ/iu;
const whyCard = (sentence) => WHY_CARD.test(String(sentence || ''));

module.exports = { levelsMoment, labelOffSubject, imperative, childTurnNear, degenerate, routineLine, closedAnswers, whyCard, LABEL_SUBJECTS };
