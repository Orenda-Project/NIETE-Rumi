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
// the loop as the teacher's question. A loop is a unit of 1–8 words said 3+ times back to back, or of 9–24 words said 5+
// times (red7 H3: Soniox loops the last utterance whatever its length; B4: a sentence said 4 times is still a lesson). Measured on the 3,000 r7 transcripts: ≥ 50% of the words inside loops flags 10
// (Q194 at 85%); a times-table drill, where each line is said twice, is not a loop. Speaker labels and stamps are not
// words; the loop test needs 20 words. A transcript of 3+ lines that are mostly placeholders («…», [inaudible]) has no
// moment either, at any length (red7 H4).
const LOOP_SHARE = 0.5;
const MIN_LOOP_WORDS = 20;
const MAX_PERIOD = 24;

/** The share of words inside back-to-back loops. */
function loopShare(words) {
  const cov = new Uint8Array(words.length);
  const same = (a, b, p) => { for (let k = 0; k < p; k++) if (words[a + k] !== words[b + k]) return false; return true; };
  for (let i = 0; i < words.length; i++) {
    for (let p = 1; p <= MAX_PERIOD && i + 3 * p <= words.length; p++) {
      // a unit of over 8 words (a whole sentence) counts from 5 repeats: a line said 4 times among real turns is a
      // lesson (red7 B4); a short phrase counts from 3
      const reps = p > 8 ? 5 : 3;
      if (i + reps * p > words.length) continue;
      let k = 1;
      while (k < reps && same(i, i + k * p, p)) k++;
      if (k < reps) continue;
      let end = i + reps * p;
      while (end + p <= words.length && same(i, end, p)) end += p;
      cov.fill(1, i, end);
      break;
    }
  }
  return words.length ? cov.reduce((a, b) => a + b, 0) / words.length : 0;
}

/** The transcript lines are mostly a recogniser loop (or placeholders): no line of it is a moment. */
function degenerate(lines) {
  const texts = (lines || []).map((l) => String(l || '').replace(/^\s*\[[\d:]+\]\s*[^:\n]{0,30}:\s*/, ''));
  // a placeholder line: no word left once «…», dashes and [bracketed] tokens are removed
  const empty = texts.filter((t) => !/[\p{L}\p{N}]/u.test(t.replace(/\[[^\]]*\]/g, ' '))).length;
  if (texts.length >= 3 && empty / texts.length >= LOOP_SHARE) return true;
  const words = texts.join(' ').match(/\[[^\]\s]+(?: [^\]\s]+)?\]|[\p{L}\p{N}]+/gu) || [];
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
  /السلام علیکم|وعلیکم السلام|\bassalam|\bgood (?:morning|afternoon)\b|\bhow are you\b|آپ کیسے ہیں|\bhello\b|تم کیسے ہو|کیسے ہیں سب|کیا حال ہے|سب ٹھیک (?:ہیں|ہو)/iu, // R7d: «تم کیسے ہو؟» (Q113)
  // R7e (COS 202042; Q179 Q136 Q063): an attention check, small talk, attendance, the phone or the recording
  /ایکٹیو ہیں|تیار ہیں|\bare you ready\b|\beveryone ready\b|اسکول کیسے آئے|سکول کیسے آئے|حاضری|\battendance\b|\broll call\b|موبائل|پاسورڈ|ریکارڈنگ|\b(?:mobile|password|recording)\b/iu,
  // page or book call
  /(?:پیج|صفحہ|صفحے)\s*(?:نمبر)?\s*[\d۰-۹]|\bpage\s*(?:no\.?|number)?\s*\d|\bopen your (?:book|copy|notebook)|(?:کتاب|کتابیں|کاپی|کاپیاں)\s+(?:کھول|نکال)|چیپٹر نمبر/iu,
  // order about the room
  /بیٹھ (?:جاؤ|جائیں|جاو)|\bsit down\b|خاموش (?:ہو|رہ)|\bbe quiet\b|\bsilence please\b|لائن (?:بنا|میں)|\bstand up\b|کھڑے ہو (?:جاؤ|جائیں)/iu,
  // announcing the lesson or what will happen in it
  /^(?=.*آج)(?=.*(?:ٹاپک|سبق|موضوع|لیسن|پڑھائی))|(?:ٹاپک|سبق|موضوع) (?:ہے|کون سا ہے|کیا ہے)|\b(?:today|now) we (?:will|are going to|shall)\b|\b(?:our|today'?s) (?:topic|lesson) is\b|\btopic is\b|ہم (?:\S+\s+){0,3}(?:پڑھیں|سیکھیں|بنائیں|دیکھیں|لکھیں|سنیں|شروع کریں|کریں) گے|(?:میں|ہم) نے (?:\S+\s+){0,8}(?:کرنا|کرنے|پڑھنا|پڑھنے|کروانا|کروانے|سیکھنا|سیکھنے) (?:ہے|ہیں)/iu,
];
const ROUTINE_SHARE = 0.6;
// R7d (COS 20261023T184404 item 5; panel Q076 Q170 Q198): routine whether or not it asks — a reprimand («آپ کیوں اتنے سست
// ہو کے بیٹھے ہیں؟»), a test announced («آج ٹیسٹ ہے آپ کا»), the lesson's topic asked («آج کا ٹاپک کیا ہے؟»).
const ASKING_ROUTINE = [
  /کیوں (?:\S+\s+){0,4}(?:سست|شور|باتیں کر|سو رہے|سوئے|دیر سے|لیٹ|نہیں لائے|نہیں لائی|نہیں لائیں)|کیا (?:ہوا|ہو گیا|ہوگیا) ہے (?:آپ|تم) (?:کو|لوگوں کو)|\bwhy (?:are|is) (?:you|he|she|they) (?:late|talking|sleeping|making (?:a )?noise)\b|\bwhy (?:didn['’]?t|did not) you bring\b/iu,
  // a test held in THIS period (a test announced for tomorrow is homework talk, P183: the card fallback, as ruled)
  /(?:آج|ابھی) (?:\S+\s+){0,3}(?:ٹیسٹ|پیپر|امتحان|کوئز)|\b(?:test|exam|quiz) (?:today|now)\b|\btoday(?:'s| is| we have)? (?:a |your |the )?(?:test|exam|quiz)\b/iu,
  /(?:ٹاپک|سبق|موضوع|لیسن)\s+(?:\S+\s+){0,2}(?:کیا|کون سا|کونسا) (?:ہے|تھا)|\bwhat(?:'s| is| was) (?:our|today'?s|the) (?:topic|lesson)\b/iu,
  // R7e (Q188 Q200 Q117 Q130): which lesson, or what we read — «آج ہم نے کون سا سبق پڑھنا ہے؟», «کیا پڑھنا ہے ہم نے؟»
  // …but «what did we learn/read today?» at the end is the closure question itself: only yesterday's lesson or the one to come
  /(?:کون سا|کونسا|کون سی|کونسی) (?:سبق|ٹاپک|موضوع|لیسن|چیپٹر|نظم|کہانی)|(?:ہم|آپ)(?: لوگ)?(?: نے)? (?:\S+\s+){0,2}کیا پڑھ(?:نا|نی|نے) (?:ہے|ہیں)|کیا پڑھنا ہے|کل (?:\S+\s+){0,4}کیا پڑھ|\bwhat (?:are|will) we (?:reading|read|studying|study) today\b|\bwhat (?:were|did) we (?:read|reading|study|studying|learn|learning|do) (?:yesterday|last (?:class|time|lesson|week))\b|\bwhich (?:lesson|chapter|topic|poem|story)\b/iu,
];
const TOPIC_STOP = new Set('what is was are the a an of this that کیا ہے ہیں تھا کون سا کس کی کا کے یہ وہ'.split(' '));
// …but a page call, an order or an announcement is a statement: a sentence that asks («ہم نے کس چیز کو سرکل کرنا ہے؟», Q135; «تو سب سے پہلے ہم کیا
// کریں گے؟», Q069), or asks why or how, is a question about the lesson
// a tag question («…، ٹھیک ہے؟», Q063) does not make a statement a question
const TAG_QUESTION = /[،,]?\s*(?:ٹھیک ہے|ہے نا|نا|okay|ok|right)\s*[?؟]\s*$/iu;
const WHY_HOW = /کیوں|کیسے|\bwhy\b|\bhow\b(?! are you)/iu;
// red7 H5: «page 46, question 3: why does the sun rise?» asks; only a greeting ("how are you?") stays routine when it asks
const asks = (x) => WHY_HOW.test(x) || /[?؟]/.test(x.replace(TAG_QUESTION, ''));
const isRoutine = (x) => ROUTINE[0].test(x) || ROUTINE[1].test(x) || ASKING_ROUTINE.some((rx) => rx.test(x)) || (ROUTINE.slice(2).some((rx) => rx.test(x)) && !asks(x));
const wordList = (x) => String(x || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

/** R7d (Q199): the sentence is the lesson's own topic said as a question or a title («What is sound» on a lesson about sound). */
function topicOnly(x, topic) {
  const t = new Set(wordList(topic));
  const w = wordList(x).filter((k) => !TOPIC_STOP.has(k));
  return t.size > 0 && w.length > 0 && w.every((k) => t.has(k));
}

/** The quoted line only greets, calls a page, orders the room, reprimands, announces a test or the lesson, or names its topic. */
function routineLine(quote, { topic = null } = {}) {
  const sentences = String(quote || '').split(/(?<=[.!?۔؟])\s+|\s*—\s*/u).filter((x) => /[\p{L}\p{N}]/u.test(x));
  const words = (x) => (x.match(/[\p{L}\p{N}]+/gu) || []).length;
  const all = sentences.reduce((n, x) => n + words(x), 0);
  if (!all) return false;
  const routine = sentences.filter((x) => isRoutine(x) || topicOnly(x, topic)).reduce((n, x) => n + words(x), 0);
  return routine / all >= ROUTINE_SHARE;
}

// R7c (COS 20261023T170515 §4; panel: 51-s3 sent 11 times, 0 right): a lesson whose children answer in a word or a chorus.
// Of the labelled child turns, ≥ 60% are ≤ 3 words and at most one in twenty gives a reason (Q121: 155 of 165 short, 3
// reasons). Unlabelled transcripts are not judged.
const CLOSED_SHARE = 0.6;
const REASON = /کیونکہ|کیوں کہ|اس لیے|\bbecause\b/iu;

// R7d (panel Q038 Q056): in Grade 1–2, children reading back the line the teacher just read is echo reading, a fluency
// technique, never a chorus answer to a question. A turn echoes a STATEMENT when it has ≥ 2 words and the two lines share
// ≥ 60% of each one's words (a one-word answer that reuses the question's word, «پلس کو ہم کیا کہتے ہیں؟» → «پلس», is an answer).
const ECHO_SHARE = 0.6;
const EARLY_GRADE = 2;
const early = (grade) => !!grade && Number.isFinite(Number(grade.hi)) && Number(grade.hi) <= EARLY_GRADE;
const textOf = (l) => String(l || '').replace(LABELLED, '');

/** The turn at `i` repeats the line before it. */
function echoOf(lines, i) {
  if (i < 1 || /[?؟]/.test(textOf(lines[i - 1]))) return false;
  const w = wordList(textOf(lines[i]));
  const prev = wordList(textOf(lines[i - 1]));
  const a = new Set(w);
  const b = new Set(prev);
  return w.length >= 2 && w.filter((k) => b.has(k)).length / w.length >= ECHO_SHARE && prev.filter((k) => a.has(k)).length / prev.length >= ECHO_SHARE;
}

/** Grade 1–2: the line at `i` is read aloud and the next line is a child echoing it (no question in it). */
function echoReading(lines, i, grade) {
  if (!early(grade) || !Array.isArray(lines) || i < 0 || i >= lines.length) return false;
  const all = lines.map(String);
  // R7e (Q038): the quote is the child's echo, or the teacher's line that the child echoes, inside an echo run
  return (KID.test(all[i + 1] || '') && !KID.test(all[i]) && echoOf(all, i + 1)) || echoChild(all, i) || echoChild(all, i + 1);
}

/** The lesson's child turns are closed or chorus answers (false when there are fewer than 3 labelled child turns). */
function closedAnswers(lines, { grade = null } = {}) {
  const all = (lines || []).map(String);
  const kids = all.filter((l, i) => KID.test(l) && !(early(grade) && echoOf(all, i))).map((l) => l.replace(LABELLED, ''));
  if (kids.length < 3) return false;
  const short = kids.filter((k) => (k.match(/[\p{L}\p{N}]+/gu) || []).length <= 3).length;
  return short / kids.length >= CLOSED_SHARE && kids.filter((k) => REASON.test(k)).length <= Math.max(1, kids.length * 0.05);
}

// R7e (COS 20261023T202042; panel Q063 Q170): a line spoken while no lesson is happening is no moment, however it reads.
// Before the class is greeted («السلام علیکم بچو» in the opening quarter, after earlier talk) the teacher is setting up the
// phone or talking to the observer; from a line that holds a test THIS period on, the period is a test.
const CLASS_GREETING = /(?:السلام علیکم|اسلام علیکم|\bassalam\w*|\bgood (?:morning|afternoon))[^\n]{0,24}?(?:بچو|بچوں|بچے|\bstudents\b|\bclass\b|\bchildren\b|\beveryone\b)/iu;
const TEST_NOW = /(?:آج|ابھی) (?:\S+\s+){0,3}(?:ٹیسٹ|پیپر|امتحان|کوئز)(?!\s*(?:کی|کے) (?:تیاری|لیے))|(?:ٹیسٹ|پیپر|امتحان) ہو رہا ہے|\b(?:test|exam|quiz) (?:today|now)\b|\btoday(?:'s| is| we have)? (?:a |your |the )?(?:test|exam|quiz)\b(?! (?:prep|preparation|revision))/iu;
const OPENING_SHARE = 0.25;

/** 'before_lesson' | 'test' | false: the line at `i` of the whole transcript is spoken while no lesson is happening. */
function notTeaching(lines, i) {
  if (!Array.isArray(lines) || i < 0 || i >= lines.length) return false;
  const texts = lines.map(textOf);
  const g = texts.findIndex((x) => CLASS_GREETING.test(x));
  if (g > 0 && g < Math.max(2, Math.ceil(texts.length * OPENING_SHARE)) && i < g) return 'before_lesson';
  if (texts.slice(0, i + 1).some((x) => TEST_NOW.test(x))) return 'test';
  return false;
}

// R7e (Q038): a CHILD line that echoes the teacher's line before it, inside an echo run (a pair either side echoes too).
function echoChild(lines, i) {
  if (i < 1 || !KID.test(String(lines[i])) || KID.test(String(lines[i - 1])) || /[?؟]/.test(textOf(lines[i - 1]))) return false;
  const w = wordList(textOf(lines[i]));
  const prev = new Set(wordList(textOf(lines[i - 1])));
  if (w.length < 2 || w.filter((k) => prev.has(k)).length / w.length < ECHO_SHARE) return false;
  return [i - 4, i - 2, i + 2, i + 4].some((n) => n >= 1 && n < lines.length && KID.test(String(lines[n])) && echoOf(lines, n));
}

// R7e (panel §6.2: Q117 Q136 Q197): a closure chapter (37-B10, v4-B7 first) answers a gap at the END of the lesson; a
// line from the first two thirds of it is no closure moment. Not a routine line: the card fallback may still carry it.
const CLOSURE_FROM = 2 / 3;
const isClosure = (segment) => !!segment && ((segment.fico_main37 || []).includes('B10') || (((segment.fico || [])[0] || {}).indicator === 'B7'));
const stampSec = (x) => { const m = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(x || '')); if (!m) return null; return m[3] ? (+m[1] * 3600) + (+m[2] * 60) + +m[3] : (+m[1] * 60) + +m[2]; };

/** The moment at `at` ("mm:ss") is before the last third of the lesson (false when the lesson's length is unknown). */
function earlyForClosure(at, lines) {
  const t = stampSec(at);
  const ends = (lines || []).map((l) => { const m = /^\s*\[([\d:]+)\]/.exec(String(l)); return m ? stampSec(m[1]) : null; }).filter((x) => x !== null);
  if (t === null || !ends.length) return false;
  const last = Math.max(...ends);
  return last > 0 && t < last * CLOSURE_FROM;
}

// The card asks for a why/how or open question.
const WHY_CARD = /کیوں|کیسے|\bwhy\b|\bhow\b|open[- ]ended|open questions?|کھلے سوال|کھلا سوال|اوپن اینڈ/iu;
const whyCard = (sentence) => WHY_CARD.test(String(sentence || ''));

module.exports = { levelsMoment, labelOffSubject, imperative, childTurnNear, degenerate, routineLine, echoReading, closedAnswers, whyCard, notTeaching, isClosure, earlyForClosure, LABEL_SUBJECTS };
