'use strict';
/**
 * THE CHILDREN IN THE ROOM ARE NEVER THE SUBJECT OF THE QUIZ.
 *
 * A lesson quiz is forwarded to the whole class. A staging quiz from an Urdu
 * word-meanings lesson asked what one named child "had told" the class a word
 * meant, and what sentence "was used in class" about another — with the option
 * that the second child makes noise in class. The teacher had used the
 * children's names in example sentences; the digest listed them as the
 * lesson's people, and the author read them in the digest and in the
 * transcript excerpts.
 *
 * Three layers, so the fault is removed at the source and still caught if it
 * gets through:
 *   1. THE DIGEST records the children the recording names (`pupils_named`),
 *      and keeps them only as one-way hashes (`pupil_tokens`): no name is
 *      stored, and every name is scrubbed from the digest's own text and from
 *      the transcript excerpts the author reads (scrubPupils).
 *   2. THE PROMPTS — the author and every rewrite that writes a question — say
 *      it (PUPILS_RULE).
 *   3. THE VALIDATOR raises PEDAGOGY_PUPIL_AS_SUBJECT, a hard fault, on any
 *      field a child sees (pupilAsSubject): a recorded child's name; a
 *      question about what a named person said or did in class; a negative
 *      claim about a named person. The targeted rewrite gets one try; the
 *      salvage drops what is left. The complaint never quotes the name.
 *
 * Pure: no I/O.
 */

const crypto = require('crypto');

// ─── tokens and hashes ───────────────────────────────────────────────────────
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
const SPLIT = /[\s،۔؟!?,.;:"'«»()[\]{}/\\\-–—‘’“”]+/u;

/** One spelling of a word: marks and direction controls gone, Arabic letter variants folded, Latin lower-cased. */
function normToken(word) {
  return String(word || '').normalize('NFC').replace(MARKS, '')
    .replace(/ي/g, 'ی').replace(/ى/g, 'ی').replace(/ك/g, 'ک').replace(/ه/g, 'ہ').replace(/ة/g, 'ہ')
    .toLowerCase()
    .trim();
}
const hashToken = (word) => crypto.createHash('sha1').update(`pupil:${normToken(word)}`).digest('hex').slice(0, 12);
const tokens = (text) => String(text || '').split(SPLIT).map(normToken).filter((w) => w.length >= 2);

/**
 * The digest's `pupils_named` as one-way hashes: each name whole, and each of
 * its words, in English letters and in Urdu script. The names themselves are
 * not kept.
 * @returns {string[]}
 */
function pupilTokens(pupilsNamed) {
  const out = new Set();
  (Array.isArray(pupilsNamed) ? pupilsNamed : []).forEach((p) => {
    const forms = (p && typeof p === 'object' ? [p.latin, p.ur] : [p]).map((x) => String(x || '').trim()).filter(Boolean);
    forms.forEach((form) => {
      const words = tokens(form);
      if (words.length > 1) out.add(hashToken(words.join(' ')));
      words.forEach((w) => out.add(hashToken(w)));
    });
  });
  return [...out].sort();
}

/**
 * `text` with every word that is a recorded child's name replaced — a run of
 * them by one «ایک بچہ» (Urdu) or "a child" (English letters). What the author
 * and the stored digest read.
 */
function scrubPupils(text, pupilHashes) {
  const set = pupilHashes instanceof Set ? pupilHashes : new Set(pupilHashes || []);
  if (typeof text !== 'string' || !set.size) return text;
  const parts = text.split(/(\s+|[،۔؟!?,.;:"'«»()[\]{}])/u);
  let out = '';
  let inRun = false;
  let held = '';   // the space after a name word, kept unless another word of the name follows
  parts.forEach((part) => {
    const w = normToken(part);
    if (w.length >= 2 && set.has(hashToken(w))) {
      if (!inRun) out += /\p{Script=Arabic}/u.test(part) ? 'ایک بچہ' : 'a child';
      inRun = true;
      held = '';
      return;
    }
    if (inRun && /^\s+$/.test(part)) { held += part; return; }
    out += held + part;
    held = '';
    if (part !== '') inRun = false;
  });
  return out + held;
}

// ─── who counts as a named person ────────────────────────────────────────────
/**
 * Given names common in Pakistani classrooms, in Urdu script and in English
 * letters. Used only beside a second signal — the subject of "said/told in
 * class", or a negative claim — never alone, so a name that is also a word
 * («حسن», beauty; «عمر», age) does not fire on its own.
 */
const GIVEN_NAMES_UR = new Set([
  'حرا', 'علی', 'احمد', 'سارہ', 'عائشہ', 'فاطمہ', 'زینب', 'مریم', 'آمنہ', 'حمزہ', 'بلال', 'عثمان', 'عمر', 'حسن', 'حسین',
  'اسد', 'سعد', 'زارا', 'اقرا', 'نادیہ', 'رابعہ', 'صائمہ', 'سعدیہ', 'عمران', 'کامران', 'فرحان', 'فیصل', 'سلمان', 'عدنان',
  'دانش', 'حارث', 'طلحہ', 'ذیشان', 'ارسلان', 'ریحان', 'بابر', 'اسلم', 'اکرم', 'ناصر', 'طارق', 'خالد', 'حامد', 'راشد',
  'شاہد', 'زبیر', 'یاسر', 'حفصہ', 'حریم', 'لائبہ', 'اریبہ', 'انعم', 'عبداللہ', 'ابراہیم', 'یوسف', 'انمول', 'زویا', 'علیزہ',
  'ایمان', 'خدیجہ', 'ارحم', 'ایان', 'ریان', 'زید', 'دانیال', 'فہد', 'منیب', 'عاشر',
  'صائم', 'حذیفہ', 'معیز', 'ابوبکر', 'عمیر', 'ماہم', 'انابیہ', 'ہانیہ', 'عنایہ', 'مہوش', 'ثمینہ', 'نمرہ', 'فائزہ', 'ماریہ',
].map(normToken));
const GIVEN_NAMES_EN = new Set([
  'hira', 'ali', 'ahmed', 'ahmad', 'sara', 'sarah', 'ayesha', 'aisha', 'fatima', 'zainab', 'maryam', 'amna', 'hamza', 'bilal',
  'usman', 'umar', 'omar', 'hassan', 'hasan', 'hussain', 'asad', 'saad', 'zara', 'iqra', 'nadia', 'rabia', 'imran', 'kamran',
  'farhan', 'faisal', 'salman', 'adnan', 'danish', 'haris', 'talha', 'zeeshan', 'arslan', 'rehan', 'hafsa', 'hareem', 'laiba',
  'abdullah', 'ibrahim', 'yusuf', 'anmol', 'zoya', 'aliza', 'eman', 'khadija', 'arham',
  'ayan', 'rayan', 'zaid', 'daniyal', 'fahad', 'muneeb', 'ashir', 'saim', 'huzaifa', 'moiz', 'abubakar', 'umair', 'maham',
]);

/** Words that are never the name of a child: pronouns, the teacher, and the agents of a story or a word problem. */
const NOT_A_CHILD_UR = new Set([
  'آپ', 'ہم', 'میں', 'تم', 'انہوں', 'اُنہوں', 'اس', 'اُس', 'ان', 'اُن', 'کسی', 'سب', 'کون', 'کس', 'کس', 'جس', 'جن', 'ایک', 'دو',
  'استاد', 'اُستاد', 'استانی', 'ٹیچر', 'میڈم', 'مِس', 'معلم', 'آپا', 'باجی', 'سر', 'صاحب', 'کلاس', 'بچوں', 'بچے', 'بچہ', 'بچی',
  'طلبہ', 'طالب', 'علم', 'لڑکے', 'لڑکا', 'لڑکی', 'دوست', 'امی', 'ابو', 'ماں', 'والد', 'والدہ', 'بھائی', 'بہن', 'کسان', 'دکاندار',
  'بادشاہ', 'ملکہ', 'شہزادہ', 'شہزادی', 'آدمی', 'عورت', 'مسافر', 'سپاہی', 'شیر', 'لومڑی', 'کوا', 'چوہا', 'بندر', 'طوطا',
].map(normToken));
const NOT_A_CHILD_EN = new Set(['the', 'a', 'an', 'your', 'our', 'my', 'his', 'her', 'their', 'this', 'that', 'we', 'you', 'they', 'he',
  'she', 'it', 'i', 'teacher', 'madam', 'miss', 'sir', 'class', 'group', 'students', 'children', 'student', 'child', 'everyone']);

/**
 * The people a question may name as a person: the digest's `people` (the
 * lesson's own characters), in both scripts, word by word.
 */
function peopleWords(digest) {
  const set = new Set();
  (Array.isArray(digest && digest.people) ? digest.people : []).forEach((p) => {
    [p && p.latin, p && p.ur].forEach((form) => tokens(form).forEach((w) => set.add(w)));
  });
  return set;
}
function keyTermWords(digest) {
  const set = new Set();
  (Array.isArray(digest && digest.key_terms) ? digest.key_terms : []).forEach((k) => {
    [k && typeof k === 'object' ? k.term : k, k && k.as_spoken].forEach((form) => tokens(form).forEach((w) => set.add(w)));
  });
  return set;
}

// ─── the three signals ───────────────────────────────────────────────────────
const QUESTION_WORD_UR = /(کون|کیا|کتن|کس\s|کہاں|کب|کیوں|کیسے)/;
const QUESTION_WORD_EN = /\b(what|which|who|how|why|when|where)\b/i;
// Speech and answering — never a generic "had done": «فاطمہ جناح نے ڈگری حاصل کی تھی» is history.
const SPEECH_VERB_UR = /(بتایا|بتائی|بتائے|کہا|کہی|کہے|پوچھا|پوچھی|پوچھے|سنایا|سنائی|سنائے|جواب\s*دیا|بولا|بولی|بولے)/;
// What a child gives when the teacher asks: a meaning, an answer, a sentence, an example.
const ANSWER_WORD_UR = /(مطلب|معنی|جواب|جملہ|جملے|مثال)/;
const ANSWER_VERB_UR = /(بتایا|بتائی|بتائے|کہا|کہی|دیا|دی|سنایا|سنائی|بنایا|بنائی|بولا|بولی)/;
const CLASS_MARKER_UR = /(کلاس\s*میں|کلاس\s*کے|سبق\s*میں|سبق\s*کے\s*دوران|آج\s*کلاس)/;
const ABOUT_UR = /کے\s*بارے\s*میں/;
const TEACHER_ASKED_UR = /(?:استاد|اُستاد|ٹیچر|میڈم|مِس|معلم)\s*(?:صاحب\s*)?نے\s+(\S+)(?:\s+(\S+))?\s+سے\s[^۔؟]*?(?:پوچھا|پوچھی|کہا)/;
// A title or an honorific marks a public or historical figure, never a child in the room.
const PUBLIC_FIGURE_UR = /(محترمہ|محترم|قائد\s*اعظم|قائدِ\s*اعظم|سر\s*سید|علامہ|حضرت|بیگم|مولانا|شیخ|ڈاکٹر|جناب|سلطان|شہید|رحمۃ\s*اللہ|رحمتہ\s*اللہ|رضی\s*اللہ|علیہ\s*السلام|صلی\s*اللہ|ﷺ)/;
const NAME_EN = '([A-Z][a-z]+)(?:\\s+([A-Z][a-z]+))?';
const MEANING_EN = new RegExp(`\\b[Ww]hat\\s+did\\s+${NAME_EN}\\s+(?:say|tell|think)\\b[^?]*\\bmeans?\\b`);
const ANSWER_EN = new RegExp(`\\b[Ww]hat\\s+(?:answer|meaning|word|sentence|example)\\s+did\\s+${NAME_EN}\\s+(?:give|say|tell|share|make|use)\\b`);
const SAID_EN = new RegExp(`\\b[Ww]hat\\s+did\\s+${NAME_EN}\\s+(?:say|tell|answer|ask|share)\\b`);
const TEACHER_ASKED_EN = new RegExp(`\\bteacher\\s+asked\\s+${NAME_EN}\\b`);
const CLASS_MARKER_EN = /\b(in class|in the class|during the lesson|today's class)\b/i;
const PUBLIC_FIGURE_EN = /\b(Quaid|Allama|Sir|Hazrat|Dr|Mr|Mrs|Miss|Madam|Begum|Prophet|Saint|King|Queen|President|Prime Minister)\b/;
// whole words, so «شور» is not found inside «شوربا»; a verb stem ends in «ت» and takes any ending
const NEGATIVE_UR = new RegExp(`(?<![\\p{L}\\p{M}])(?:${[
  'شور', 'شرارت', 'شرارتی', 'لڑائی', 'جھگڑا', 'جھوٹ', 'جھوٹا', 'جھوٹی', 'سست', 'کاہل', 'نالائق', 'نکما', 'نکمی', 'کام\\s*چور',
  'بدتمیز', 'گستاخ', 'گندا', 'گندی', 'چوری', 'چور', 'غیر\\s*حاضر', 'فیل', 'بیوقوف', 'بے\\s*وقوف', 'ضدی',
].join('|')})(?![\\p{L}\\p{M}])|(?<![\\p{L}\\p{M}])(?:لڑت|مارت|روت|دیر\\s*سے\\s*آت|تنگ\\s*کرت|نقل\\s*کرت|باتیں\\s*کرت|سوتا\\s*رہت|سوتی\\s*رہت)`, 'u');
const NEGATIVE_EN = /\b(noisy|makes? (a )?noise|naughty|lazy|lies|liar|lying|fights?|fighting|rude|dirty|stupid|fails?|failed|cheats?|cheating|steals?|stealing|late|absent|bully|bullies|shouts?|talks in class|sleeps in class|disturbs?)\b/i;
const SENTENCE = /[۔؟?!.\n]+/;

/**
 * Is `word` (normalised) a person in this question? A recorded child always;
 * the lesson's own characters and the common given names only beside a second
 * signal (the callers).
 */
function personIn(words, { pupils, people }) {
  return words.some((w) => pupils.has(hashToken(w)) || people.has(w) || GIVEN_NAMES_UR.has(w) || GIVEN_NAMES_EN.has(w));
}

/**
 * The reason ONE question makes a child from the class its subject, or null.
 * Reads only what a child sees: the stem, the options, the explanation and the
 * feedback (the teacher's notes stay the teacher's).
 * @returns {string|null}
 */
function pupilAsSubject(q, { digest } = {}) {
  if (!q || typeof q !== 'object') return null;
  const pupils = new Set(Array.isArray(digest && digest.pupil_tokens) ? digest.pupil_tokens : []);
  const people = peopleWords(digest);
  const terms = keyTermWords(digest);
  const fb = q.option_feedback || {};
  const fields = [q.question, ...(Array.isArray(q.options) ? q.options : []), q.explanation, fb.correct, ...Object.values(fb.wrong || {})]
    .map((t) => String(t || '')).filter(Boolean);

  // 1 — a child the recording names, anywhere a child reads
  if (pupils.size && fields.some((t) => tokens(t).some((w) => !people.has(w) && !terms.has(w) && pupils.has(hashToken(w))))) {
    return 'it names a child from the recording';
  }

  // 2 — what a named child said, answered or was asked in class (the stem).
  // The classroom shapes only: a named person giving a meaning, an answer, a
  // sentence or an example; a named person's words with a class marker; the
  // teacher asking a named person. A title or an honorific is a public figure.
  // A sweep of shipped production questions showed why it is this narrow: any
  // named person with a past verb flagged 24, and history, textbook stories
  // and a news item were nearly all of them.
  const stem = String(q.question || '');
  const isChild = (words, sentence, markerRe) => {
    const named = words.filter(Boolean).map(normToken).filter((w) => !NOT_A_CHILD_UR.has(w) && !NOT_A_CHILD_EN.has(w));
    if (!named.length || !personIn(named, { pupils, people })) return false;
    // one of the lesson's own characters is asked about freely — unless the question is about the class
    return !named.some((w) => people.has(w)) || markerRe.test(sentence);
  };
  for (const sentence of stem.split(SENTENCE)) {
    if (QUESTION_WORD_UR.test(sentence) && !PUBLIC_FIGURE_UR.test(sentence)) {
      const m = /(\S+)(?:\s+(\S+))?\s+نے(?![\p{L}])/u.exec(sentence);
      if (m && !NOT_A_CHILD_UR.has(normToken(m[2] || m[1]))) {
        const after = sentence.slice(m.index + m[0].length);
        const answered = ANSWER_WORD_UR.test(after) && ANSWER_VERB_UR.test(after);
        const classSaid = CLASS_MARKER_UR.test(sentence) && SPEECH_VERB_UR.test(after);
        if ((answered || classSaid) && isChild([m[1], m[2]], sentence, CLASS_MARKER_UR)) return 'it asks what a child said or did in class';
      }
      const t = TEACHER_ASKED_UR.exec(sentence);
      if (t && isChild([t[1], t[2]], sentence, CLASS_MARKER_UR)) return 'it asks what a child said or did in class';
      if (CLASS_MARKER_UR.test(sentence) && ABOUT_UR.test(sentence)
        && personIn(tokens(sentence).filter((w) => !people.has(w)), { pupils, people: new Set() })) return 'it asks what a child said or did in class';
    }
    if (QUESTION_WORD_EN.test(sentence) && !PUBLIC_FIGURE_EN.test(sentence)) {
      const en = MEANING_EN.exec(sentence) || ANSWER_EN.exec(sentence) || TEACHER_ASKED_EN.exec(sentence)
        || (CLASS_MARKER_EN.test(sentence) && SAID_EN.exec(sentence));
      if (en && isChild([en[1], en[2]], sentence, CLASS_MARKER_EN)) return 'it asks what a child said or did in class';
    }
  }

  // 3 — a negative claim about a named person, in any field
  for (const text of fields) {
    for (const sentence of text.split(SENTENCE)) {
      if (!(NEGATIVE_UR.test(sentence) || NEGATIVE_EN.test(sentence))) continue;
      if (PUBLIC_FIGURE_UR.test(sentence) || PUBLIC_FIGURE_EN.test(sentence)) continue;
      if (personIn(tokens(sentence), { pupils, people })) return 'it says something negative about a named child';
    }
  }
  return null;
}

/** The complaint, never quoting a name (data standard D4: this line is logged). */
function pupilComplaint(i, why) {
  return `q${i}: PEDAGOGY_PUPIL_AS_SUBJECT — ${why}. The quiz is forwarded to the whole class, so a child from the class is never named in it, never its subject, and never the subject of a claim. Write a NEW question on the same SLO and level about the lesson's idea, with no child's name and nothing about what anyone said or did in class; where an example needs a person, use «ایک بچہ» / "a child" or one of the lesson's own characters.`;
}

/** The rule every writer is given up front, in either language. */
const PUPILS_RULE = 'THE CHILDREN IN THE ROOM ARE NEVER IN THE QUIZ. The quiz is forwarded to the whole class. Never name a child from the lesson — not in a question, an option, an explanation or feedback — and never ask what a child said, answered or did in class ("What did Sara say…?", «… نے کیا بتایا تھا؟», «کلاس میں … کے بارے میں …»). Never write a sentence about a child\'s behaviour, good or bad. When an example needs a person, use one of the lesson\'s own characters (its "people") or «ایک بچہ» / "a child". The question is always about the lesson\'s idea.';

/** The digest rule that records the children, so the quiz can be checked for them without keeping their names. */
const PUPILS_DIGEST_RULE = '- "pupils_named": every child (and any other person present) the RECORDING names — a child called on, praised or corrected («احمد، بورڈ پر آئیں»), and a child the teacher uses in an example sentence about the class («سارہ اپنی کاپی میں لکھ رہی ہے» is about a child in the room) — each once, as { "latin": the name in English letters, "ur": the same name in Urdu script }. A child in the room is never in "people". These names are never written into the quiz: they are recorded so the quiz can be checked for them. [] when none.';

module.exports = {
  normToken, hashToken, pupilTokens, scrubPupils, pupilAsSubject, pupilComplaint, PUPILS_RULE, PUPILS_DIGEST_RULE,
  GIVEN_NAMES_UR, GIVEN_NAMES_EN,
};
