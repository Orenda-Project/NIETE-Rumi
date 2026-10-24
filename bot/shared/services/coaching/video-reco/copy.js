'use strict';
/**
 * The words around a recommended training clip — bd-gzfdu9 (VIDREC), SPEC §4.2. Pure.
 *
 * The strings live in the catalog (ux-strings.js, `videoReco*`); this file only fills them: whole minutes
 * (Urdu-Indic digits for ur), the clip's language by name, and the LLM's reason, whose English runs inside
 * an Urdu line are set in their own left-to-right isolates (U+2066…U+2069) so the line reads right to left.
 * Used by send.js (the WhatsApp message), the /cr card and the /v player.
 */
const { resolveUx, clampLanguage } = require('../../../config/ux-strings');
const { getLanguage } = require('../../../config/languages');

const BODY_MAX = 1024; // Meta's cap on an interactive body, in code points
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const LRI = '\u2066';
const FSI = '\u2068';
const PDI = '\u2069';
const RLM = '‏';

/** The reader's language as NIETE offers it (flat en/ur, language-protocol): the catalog's own clamp. */
const lang = (l) => clampLanguage(l);
/** 'rtl' | 'ltr' from the language registry. */
const dirOf = (l) => (getLanguage(lang(l))?.direction === 'rtl' ? 'rtl' : 'ltr');
/** A row's per-language field (`title_ur`, `reason_ur`, …), falling back to the English one. */
const localized = (obj, field, l) => (obj && (obj[`${field}_${lang(l)}`] || obj[`${field}_en`])) || null;

/** Whole minutes for a clip of `s` seconds, never below 1. */
function minutesOf(s) {
  const n = Math.round((Number(s) || 0) / 60);
  return n < 1 ? 1 : n;
}

const urduDigits = (n) => String(n).replace(/[0-9]/g, (d) => URDU_DIGITS[Number(d)]);
const DIGITS = { ur: urduDigits };
const num = (n, l) => (DIGITS[l] || String)(n);

/** 95 → "1:35". */
function clock(s) {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

const LANG_KEY = { ur: 'videoRecoLangUr', en: 'videoRecoLangEn', mixed: 'videoRecoLangMixed' };
const clipLanguageName = (clipLanguage, l) => resolveUx(LANG_KEY[clipLanguage] || LANG_KEY.ur, { language: l });

/**
 * Each Latin phrase inside an Urdu line in its own isolate, and the line opened right to left. A phrase is
 * Latin words joined by spaces/hyphens/apostrophes, with a number that leads into them («4 digit addition», R7b); a bare
 * number or clock ("12:40") is left alone.
 */
function isolateLatin(text, mark = true) {
  const s = String(text || '');
  if (!s) return s;
  // Text already inside an isolate (a quoted moment, bd-8hhqhf) and a name placeholder ([a student], R7b) are left as
  // they are; only the rest is scanned.
  const out = s.split(/([\u2066-\u2068][^\u2066-\u2069]*\u2069|\[(?:a student|CHILD|TEACHER)\])/).map((part, i) => (i % 2 ? part
    : part.replace(/(?:[0-9][0-9.,:–-]*\s+)?[A-Za-z][A-Za-z0-9'’-]*(?:\s+[A-Za-z0-9][A-Za-z0-9'’-]*)*/g, (run) => `${LRI}${run}${PDI}`))).join('');
  if (!mark) return out;
  const first = [...out].find((ch) => /\p{L}/u.test(ch) && !/[⁦-⁩]/.test(ch));
  return first && /[؀-ۿ]/.test(first) ? out : `${RLM}${out}`;
}

/** Bidi embedding/override/isolate controls removed (U+202A–202E, U+2066–2069): a stray PDI in model text would close an outer isolate. */
const stripBidi = (text) => (typeof text === 'string' ? text.replace(/[\u202A-\u202E\u2066-\u2069]/g, '') : text);

const QUOTE_PAIR = /"([^"]+)"|“([^”]+)”|«([^»]+)»/g;
const ISOLATE_CH = /[\u2066-\u2069]/;
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Each quoted pair isolated — only when the pairing cannot be wrong: one pair, or several holding no Urdu text. */
function isolatePairs(text) {
  const pairs = [...text.matchAll(QUOTE_PAIR)];
  if (!pairs.length) return text;
  if (pairs.length > 1 && pairs.some((p) => ARABIC_SCRIPT.test(p[1] ?? p[2] ?? p[3]))) return text; // inner quotes possible: no guess
  return text.replace(QUOTE_PAIR, (m, a, b, c) => {
    const q = a ?? b ?? c;
    return ISOLATE_CH.test(q[0]) ? m : `${m[0]}${FSI}${q}${PDI}${m[m.length - 1]}`;
  });
}

/**
 * Every quoted lesson moment in a reason set in its own first-strong isolate (FSI…PDI), inside the quote marks, so an
 * Urdu quote in an English line (or a quote opening with a digit, "9 ہم نے …") renders in place on WhatsApp, /cr and
 * the React card (bd-8hhqhf, live session c53bf86d). `quote` is the moment the validator accepted: the longest stretch
 * between two quote marks that lies inside it is the moment, however many quote marks it holds (red7 070727,
 * d029b87c «اب "سی" اے ٹی …»); the rest of the text gets isolatePairs. A text with no quote is unchanged.
 */
function isolateQuotes(text, quote) {
  if (typeof text !== 'string' || !text) return text;
  const q = typeof quote === 'string' ? quote : '';
  const marks = [...text.matchAll(/["“”«»]/g)].map((m) => m.index);
  let best = null;
  for (let i = 0; q && i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      const inner = text.slice(marks[i] + 1, marks[j]);
      if ([...inner.trim()].length >= 6 && !ISOLATE_CH.test(inner) && q.includes(inner.trim()) && (!best || inner.length > best.inner.length)) best = { i: marks[i], j: marks[j], inner };
    }
  }
  if (!best) return isolatePairs(text);
  return `${isolatePairs(text.slice(0, best.i))}${text[best.i]}${FSI}${best.inner}${PDI}${text[best.j]}${isolatePairs(text.slice(best.j + 1))}`;
}

const AR = '\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF';
// An Urdu run inside an English line: Urdu words with the spaces, digits, Urdu punctuation and "..." between them.
const AR_RUN = new RegExp(`[${AR}](?:[${AR}\\s\\d،۔؟؛…]|\\.{2,3}|[,.!?](?=\\s*[${AR}]))*`, 'g');

/** Each Urdu run of an English line, outside existing isolates, in its own FSI…PDI (no quote marks are added). */
function isolateArabic(text) {
  const s = String(text || '');
  return s.split(/([\u2066-\u2068][^\u2066-\u2069]*\u2069)/).map((part, i) => (i % 2 ? part
    : part.replace(AR_RUN, (run) => { const t = run.trimEnd(); return `${FSI}${t}${PDI}${run.slice(t.length)}`; }))).join('');
}

// Any case: a label only counts at a sentence start (LINE_PREFIX_AT), so "the teacher: …" mid-sentence is untouched.
const LABEL = '(?:[Tt]eacher|[Ss]tudents?|[Ss]peaker|[Cc]oach|ٹیچر|استاد|استانی|طالب علم|بچہ|بچے|بچی)(?:\\s*\\([A-Za-z]{2}\\))?';
// A copied line prefix at a sentence start: "[mm:ss] Label:", "[mm:ss]", "mm:ss:" or a bare "Label:" (COS 081156).
const LINE_PREFIX_AT = new RegExp(`(^|[.!?۔؟]\\s+)(?:\\[\\d{1,2}:\\d{2}(?::\\d{2})?\\]\\s*(?:${LABEL}\\s*:)?|\\d{1,2}:\\d{2}(?::\\d{2})?\\s*:|${LABEL}\\s*:)\\s*`, 'g');

/**
 * The stored reason (bd-8hhqhf r7; red7 075837 / 080908; COS 081156 = the panel's option 1): a copied transcript prefix
 * («[10:51] Teacher:», «00:00:», «استاد:») is dropped, clock stamp and label both; the accepted moment is isolated
 * (isolateQuotes); in the English reason every Urdu run outside an isolate is isolated too, so an unquoted moment
 * renders in place. No quote mark is ever added.
 */
// A child placeholder used as a vocative at the very start, inside an opening quote mark or not (scale-run 084820):
// the reason must never open with it ([v1.3c-5]); the quote stays a verbatim stretch of the line without it.
// One or more in a row («[a student]، [a student]، آپ دونوں پڑھیں», red7 085645).
const LEADING_VOCATIVE = /^(\s*["“«]?)\s*(?:\[(?:a student|CHILD)\]\s*[،,:]\s*)+/;

/** The copied prefix and the leading vocative, stripped until neither is left («[a student]، [00:12] …»). */
function stripLead(text) {
  let s = text;
  let prev;
  do {
    prev = s;
    s = s.replace(LINE_PREFIX_AT, '$1').replace(LEADING_VOCATIVE, '$1');
  } while (s !== prev);
  return s;
}

// R7b (panel §4 item 5; language-protocol §9.4): one digit system per message. R7f: the frame's, everywhere in the line.
// R7f (COS 223858 1d; panel v5 §4, 8 rows): one digit system per message, the frame's — the quoted card or lesson line too.
const westernDigits = (text) => text.replace(/[۰-۹٠-٩]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(d) : '٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
// R7f (panel Q056 Q098 Q100 Q143 Q165): Latin punctuation right after an Urdu word is the Urdu mark; an English sentence keeps its own
const urduPunctuation = (text) => text
  .replace(/(?<=[\u0600-\u06FF])\s?\?/g, '؟')
  .replace(/(?<=[\u0600-\u06FF]),(?=\s*[\u0600-\u06FF])/g, '،')
  .replace(/(?<=[\u0600-\u06FF])\.(?![.\d])/g, '۔');
/** The Urdu line's own form of a text: Urdu digits everywhere, Urdu punctuation after Urdu words. */
const urduForm = (text) => urduPunctuation(urduDigits(text));

/**
 * The stored reason. Urdu: Urdu digits, the CJK stop «。» as «۔», every Latin run in its own LTR isolate (translate-or-isolate,
 * R7b; the WhatsApp body's isolateLatin skips runs already isolated). English: Western digits, «。» as «.», Urdu runs isolated.
 */
function composeReason(text, language, quote, { subject = null } = {}) {
  if (typeof text !== 'string' || !text) return text;
  if (lang(language) === 'en') return isolateArabic(westernDigits(isolateQuotes(stripLead(text), quote).replace(/。\s*/g, '. ').trim()));
  // R7f (COS 223858 1d): every digit is the frame's (Urdu), the accepted moment and a quoted card included; the moment is
  // matched in that same form so it is still isolated in place
  // red7 N4/H7: the word table and the digit rule leave the lesson's own words alone (the accepted moment, and the card
  // sentence the fallback template isolates); a quoted suggestion the model wrote is its own copy and is rewritten
  const q = typeof quote === 'string' ? quote : '';
  const own = (span) => /^[\u2066-\u2068]/.test(span) || (!!q && [...span.slice(1, -1).trim()].length >= 6 && q.includes(span.slice(1, -1).trim()));
  const parts = stripLead(text).replace(/。/g, '۔').split(QUOTED_SPAN);
  const words = (part, i) => (i % 2 ? urduWordTable(part, subject) : urduImperative(latinTerms(urduWordTable(part, subject)))); // R7d: never inside a quote
  const fixed = urduForm(parts.map((part, i) => (i % 2 && own(part) ? part : words(part, i))).join(''));
  return isolateLatin(isolateQuotes(fixed, q ? urduForm(q) : quote), false); // the WhatsApp body adds its own RLM
}

// R7c (COS 20261023T170515 §6; panel ped/REVIEW_r7b_rejudge.md §4): the model's recurring Urdu slips, each fixed to the word a
// teacher uses. Only forms that are wrong in every context are rewritten; «جوڑ» stays where it means addition.
const URDU_WORDS = [
  [/(^|[\s«"(])جوڑ(?= میں(?=[\s،۔]|$))/gu, '$1جوڑوں'], // pairs (Q092 Q096 Q101 Q111 Q145)
  [/(^|[\s«"(])جوڑ(?= بنا)/gu, '$1جوڑے'],
  [/(^|[\s«"(])ہمزات(?=[\s،۔]|$)/gu, '$1ساتھی'], // Q101
  [/(^|[\s«"(])طبقے(?=[\s،۔]|$)/gu, '$1کلاس'], // «class» (Q137)
  [/جگہ قدر/gu, 'مقامی قدر'], // place value (Q098)
  [/پورے کلاس/gu, 'پوری کلاس'], // Q081 Q105
  [/اگلے کلاس/gu, 'اگلی کلاس'], // Q020
  [/(^|[\s«"(])یاداشت/gu, '$1یادداشت'], // Q167
  [/مثلاََ|مثلاَ/gu, 'مثلاً'], // Q164
  // "why do you think" calque (Q082 Q149 Q200); red7 N5: «کیوں» goes after the subject, so the clause keeps its order
  [/آپ کیوں سوچتے ہیں کہ ([^؟?۔]+?)\s*([؟?])/gu, 'آپ کے خیال میں $1، ایسا کیوں$2'],
  [/آپ کیوں سوچتے ہیں/gu, 'آپ کے خیال میں ایسا کیوں ہے'],
  [/(^|[\s«"(])پروب(?=[\s،۔]|$)/gu, '$1مزید سوال'], // Q141
  // R7d (COS 20261023T184404 item 7; panel ped/REVIEW_r7c_rejudge.md §4): the fixed list
  [/[يى]/gu, 'ی'], [/ك/gu, 'ک'], // an Arabic letter in an Urdu word («پوچھي», Q103)
  [/یاددہانی\s*\/\s*ہاں\s*[-–\/]\s*نہ(?:یں|اں)? سوال/gu, 'ہاں/نہیں والا سوال'], // R7f: «یاددہانی / ہاں-نہ سوال» (Q033)
  // R7g (COS 002603 1b; panel v6 Z062): a recall label on a yes/no question is the yes/no question
  [/(?:یاددہانی|یادداشت|ریکال)(?: کا| کی| والا)?\s*ہاں\s*[\/-]\s*نہ(?:یں|اں)?(?: والا)? سوال/gu, 'ہاں/نہیں والا سوال'],
  // recall question (Q014 Q131 Q179 Q182; R7f «کی» Q189, «ریکال» red7 D1). R7g (panel v6 Z032 Z114 Z169 Z208 Z118 Z025): the
  // approved word is the catalogue's own «یاد سے بتانا» (Bloom chapter title), never «یادداشت پر مبنی سوال»
  [/(?:یاددہانی|ریکال|یادداشت|یاد رکھنے)(?: پر مبنی| والا| والی| کی| کا| کے)? سوالات/gu, 'یاد سے بتانے والے سوالات'],
  [/(?:یاددہانی|ریکال|یادداشت|یاد رکھنے)(?:ی| پر مبنی| والا| والی| کی| کا| کے)? سوال/gu, 'یاد سے بتانے والا سوال'],
  [/(^|[\s«"(])گرمی(?: کا| والا)? سوال/gu, '$1ابتدائی سوال'], // warm-up (Z113)
  [/جو مل کر جواب لات(?:ا|ے) (?:ہے|ہیں)/gu, 'جس کا جواب سب مل کر دیتے ہیں'], // chorus answer (Z102)
  [/طلبہ کا کلام بند رہا/gu, 'بچوں کی آپس میں بات چیت نہیں ہوئی'], [/طلبہ کا کلام/gu, 'بچوں کی آپس میں بات چیت'], // student talk (Z139)
  [/ہاں\s*\/\s*نہ(?:یں)?\s+پوچھا/gu, 'ہاں/نہیں والا سوال پوچھا'], // «asked yes/no» (Z151)
  [/(^|[\s«"(])ہاں\s*\/\s*نہ(?:اں)?(?=[\s،۔]|$)/gu, '$1ہاں/نہیں'], // «ہاں/نہ» (Z001)
  [/فوراً(?:\s+فوراً)+/gu, 'فوراً'], // doubled (Z081)
  [/(^|[\s«"(])بندہ\s+(?=ہاں)/gu, '$1'], [/(^|[\s«"(])بندہ(?= سوال)/gu, '$1بند'], // «بندہ» for «بند» (Z001)
  [/(^|[\s«"(])جوڑ کی گفتگو/gu, '$1جوڑوں میں گفتگو'], // pair (Q032)
  [/(^|[\s«"(])ایک جوڑ (کی|کا|کے)(?=\s)/gu, '$1ایک جوڑے $2'], // Q178
  [/(^|[\s«"(])طالب(?=\s)(?!\s+علم)/gu, '$1طالب علم'], // student (Q082 Q100)
  [/نفی (?:کا )?(?:مسئلہ|سوال)/gu, 'تفریق کا سوال'], // subtraction (Q045)
  [/(^|[\s«"(])چہار(?=\s)(?!\s+(?:سو|طرف|جانب))/gu, '$1چار'], // four (Q128)
  [/(^|[\s«"(])پوچھائی(?=[\s،۔؟]|$)/gu, '$1پوچھی'], // asked (Q165)
  [/پیشن گوئی/gu, 'پیشین گوئی'], // Q103
  [/(^|[\s«"(،,])کہ کر(?=[\s،۔"«]|$)/gu, '$1کہہ کر'], // R7e: "saying" (Q106)
  // R7f (COS 223858 1d; panel v5 §4: the Urdu line en-report teachers read, 71.4% ok) — the slips the panel named
  [/(^|[\s«"(\/])ہاں\s*[-–]\s*نہ(?:یں|اں)?(?=[\s\/،۔]|$)/gu, '$1ہاں/نہیں'], // «ہاں–نہاں» (Q066)
  [/(^|[\s«"(])کورس (?=جواب)/gu, '$1اجتماعی '], // chorus answers (Q189)
  [/(^|[\s«"(])کورس میں(?=[\s،۔]|$)/gu, '$1مل کر'],
  [/کلی طور پر (?=جواب)/gu, 'اجتماعی طور پر '], // chorus, mistranslated (Q126)
  [/آگے بڑھا(?=[\s:،۔]|$)/gu, 'آگے بڑھے'], [/آگے بڑھ گیا(?=[\s:،۔]|$)/gu, 'آگے بڑھ گئے'], // masculine singular (Q055)
  [/(کیا|دیا|لیا) جب وہ پوچھتے ہیں/gu, '$1 جب انہوں نے پوچھا'], [/(کیا|دیا|لیا) جب وہ کہتے ہیں/gu, '$1 جب انہوں نے کہا'], // tense (Q157)
  [/سننے جائیں/gu, 'سنے جائیں'], // Q047
  [/دوبارہ سوال میں/gu, 'دہرائی کے دوران'], // "during the review" (Q131)
  [/بغیر شریکِ? طالبِ? ?علم کی گفتگو کے/gu, 'ساتھی سے گفتگو کے بغیر'], [/شریکِ? طالبِ? ?علم/gu, 'ساتھی'], // partner (Q143)
];
// R7f (same rows: Q006 Q025 Q111 Q143): the English teaching terms the model leaves in its own Urdu prose (never in a quote)
const LATIN_TERMS = [
  [/\brecall\s*(?:\/|or)?\s*yes\s*[/-]\s*no(?:\s+والا)?(?=\s+سوال)/gi, 'ہاں/نہیں والا'],
  [/\byes\s*[/-]\s*no(?:\s+والے)?(?=\s+سوال(?:ات|وں))/gi, 'ہاں/نہیں والے'],
  [/\byes\s*[/-]\s*no(?:\s+والا)?(?=\s+سوال)/gi, 'ہاں/نہیں والا'],
  [/\brecall(?:[- ]based)?(?=\s+سوال)/gi, 'یاد سے بتانے والا'], // R7g: the approved word (was «یادداشت پر مبنی», panel v6 ×4)
  [/\b(?:open\s+)?why\s*\/\s*how(?=\s+سوال)/gi, 'کیوں/کیسے والا'],
  [/\bwhy(?=\s+سوال)/gi, 'کیوں والا'],
  [/\bopen[- ]ended(?=\s+سوال(?:ات|وں))/gi, 'کھلے'], [/\bopen[- ]ended(?=\s+سوال)/gi, 'کھلا'],
  [/\bchorus(?=\s+جواب)/gi, 'اجتماعی'], [/\bchorus\s+میں/gi, 'مل کر'],
  [/\bpartner explanation\b/gi, 'ساتھی کو سمجھانا'], [/\bwait time\b/gi, 'انتظار کا وقفہ'], [/\bthink time\b/gi, 'سوچنے کا وقت'],
  [/\b(?:(?:short|brief)\s+)?(?:structured\s+)?(?:peer|partner|pair)\s+talk\b/gi, 'ساتھی سے بات چیت'], // R7g (Z172 Z200)
];
const latinTerms = (text) => LATIN_TERMS.reduce((t, [rx, to]) => t.replace(rx, to), text);
// factors (Q072): «عناصر» is right in a science lesson (elements), wrong in a maths one
const MATHS_WORDS = [[/(^|[\s«"(])عناصر(?=[\s،۔]|$)/gu, '$1اجزائے ضربی']];
const urduWordTable = (text, subject = null) => [...URDU_WORDS, ...(subject === 'maths' ? MATHS_WORDS : [])].reduce((t, [rx, to]) => t.replace(rx, to), text);

// R7d (Q163): the familiar imperative addressed to the teacher becomes the polite one; a quoted line to children keeps it.
const FAMILIAR = { کہو: 'کہیں', کرو: 'کریں', پوچھو: 'پوچھیں', بتاؤ: 'بتائیں', دیکھو: 'دیکھیں', لکھو: 'لکھیں', رکھو: 'رکھیں', سنو: 'سنیں', کرواؤ: 'کروائیں', کراؤ: 'کرائیں', سمجھاؤ: 'سمجھائیں' };
const FAMILIAR_RX = new RegExp(`(^|[\\s«"(،])(${Object.keys(FAMILIAR).join('|')})(?=[\\s،۔؟!.]|$)`, 'gu');
const urduImperative = (text) => text.replace(FAMILIAR_RX, (m, pre, w) => `${pre}${FAMILIAR[w]}`);

// A quoted span: an isolate, or a pair of quote marks (the parts at odd indexes after a split)
const QUOTED_SPAN = /([\u2066-\u2068][^\u2066-\u2069]*\u2069|"[^"]*"|«[^»]*»|“[^”]*”)/;

// An Urdu line sets its English runs in isolates; other lines are as written.
const LINE = { ur: isolateLatin };

function cut(text, max) {
  const cps = [...text];
  return cps.length <= max ? text : `${cps.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}

function buttonText({ minutes, language }) {
  const l = lang(language);
  return resolveUx('videoRecoButton', { language: l, params: { n: num(minutes, l) } });
}

function cardButton({ minutes, language }) {
  const l = lang(language);
  return resolveUx('videoRecoCardButton', { language: l, params: { n: num(minutes, l) } });
}

/** lead \n reason \n meta — the reason is cut first so the whole body stays ≤ 1024 code points. */
function messageBody({ minutes, reason, clipLanguage, language }) {
  const l = lang(language);
  const lead = resolveUx('videoRecoBodyLead', { language: l, params: { n: num(minutes, l) } });
  const meta = resolveUx('videoRecoBodyMeta', { language: l, params: { n: num(minutes, l), lang: clipLanguageName(clipLanguage, l) } });
  const r = String(reason || '').replace(/\s+/g, ' ').trim();
  if (!r) return `${lead}\n${meta}`;
  const room = BODY_MAX - [...lead].length - [...meta].length - 2;
  const line = cut((LINE[l] || String)(r), room);
  return `${lead}\n${line}\n${meta}`;
}

/** A plain catalog line in the reader's language (player + card labels). */
const word = (key, language, params) => resolveUx(key, { language: lang(language), params });

module.exports = {
  lang, dirOf, localized, num, minutesOf, urduDigits, clock, isolateLatin, isolateQuotes, isolateArabic, composeReason, stripBidi, buttonText, cardButton, messageBody, clipLanguageName, word, BODY_MAX,
};
