'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { FRAME_WORDS, QUOTE_SPAN, writtenKey } = require('./given-back');
const { keyAt } = require('./key-order');
const { BACK_RULES, NAME_ASK, SST_A_Q1, WORD_ASK, keyOption, termClass } = require('./points-cross');
const { Q6_SLOT } = require('./sst-recall');
const { OPTION_HEAD, STOP, UR_FORMS, UR_MARKS, keyText, plain } = require('./stem-tags');
const { HOMOGRAPH, NAME_KEY_WORDS, nounFold } = require('./urdu-key-rules');

const NOT_NAMES = new Set(('لفظ الفاظ لفظوں جملہ جملے جملوں مطلب معنی مفہوم مراد کہانی سبق نظم شعر درست صحیح غلط قسم '
  + 'استعمال متضاد مترادف محاورہ محاورے حکایت کرنا کرنے کرنی ہونا ہونے جانا جانے آنا آنے دینا دینے لینا لینے لگنا بہت')
  .split(' ').flatMap((w) => [plain(w), nounFold(plain(w))]));
const verbal = (w) => /(?:نا|نے)$/.test(w) && [...w].length >= 4;
const namesOf = (text) => plain(text).split(' ').filter((w) => [...w].length >= 3 && !STOP.has(w) && !NOT_NAMES.has(w) && !verbal(w));
const headOf = (text) => { const words = namesOf(text); return words.length ? nounFold(words[words.length - 1]) : null; };
function namesKeyOf(q, by) {
  if (!Array.isArray(q.options) || q.options.length < 2) return false;
  const key = plain(keyOption(q));
  if (!key || key.split(' ').length > NAME_KEY_WORDS) return false;
  const own = new Set(namesOf(q.question).map(nounFold));
  // What the other item prints as true: its stem, and its correct option when that option says
  // something (two words or more, not this item's own key: a bare «کراچی» among four cities tells
  // nothing). A wrong option is never read.
  const told = Array.isArray(by.options) && by.options.length ? plain(keyOption(by)) : '';
  const said = `${by.question || ''} ${told.split(' ').length >= 2 && told !== key ? told : ''}`;
  const named = new Set(namesOf(said).map(nounFold).filter((w) => !own.has(w)));
  const heads = q.options.map((o) => headOf(String(o).replace(OPTION_HEAD, '')));
  const hit = heads.map((h, i) => (h && named.has(h) ? i : -1)).filter((i) => i >= 0);
  if (hit.length !== 1 || plain(String(q.options[hit[0]]).replace(OPTION_HEAD, '')) !== key) return false;
  const story = new Set(namesOf(by.question).map(nounFold).filter((w) => w !== heads[hit[0]]));
  return namesOf(q.question).some((w) => story.has(nounFold(w)));
}
const storyCue = (a, b) => namesKeyOf(a, b) || namesKeyOf(b, a);
function namePrinted(q, by) {
  if (!Array.isArray(q.options) || q.options.length < 2) return false;
  const stem = plain(q.question);
  if (!NAME_ASK.test(stem) || WORD_ASK.test(stem)) return false;
  const key = plain(keyOption(q));
  if (!key || key.includes(' ') || [...key].length < 3 || STOP.has(key) || termClass(key)) return false;
  const holds = (text) => ` ${plain(text)} `.includes(` ${key} `);
  if (q.options.filter((o) => holds(String(o).replace(OPTION_HEAD, ''))).length !== 1) return false;
  const told = Array.isArray(by.options) && by.options.length ? plain(keyOption(by)) : '';
  return holds(by.question) || (told !== key && told.includes(' ') && holds(told));
}
const nameCue = (a, b) => namePrinted(a, b) || namePrinted(b, a);
// Urdu Q1: a key of several words that carries a name («ایدھی فاؤنڈیشن میں … لوگوں کی مدد کرنا»;
// «قائدِ اعظم کے مزار کے احاطے میں») which no other option carries and the item's own stem does not
// print, given away by another item's stem or correct option that prints that name as a person
// («ایدھی صاحب نے …», «قائدِ اعظم نے …», «محترمہ فاطمہ جناح …»). A word is read as a name only where the
// other text marks it so (followed by «صاحب / صاحبہ / نے», or after «محترم / محترمہ / جناب»): a
// common word a key shares with another stem («بچے») is not one, nor is a word inside an example the
// other stem quotes («جملے «بچے نے ٹھنڈا پانی پیا» میں …»). An item that asks about a word asks no name.
// The item whose key is given away is the one held, never the stems that name it (the lesson's hero
// may be named in many).
const NAME_AFTER = new Set(['صاحب', 'صاحبہ', 'نے']);
const NAME_BEFORE = new Set(['محترم', 'محترمہ', 'جناب']);
const NOT_PERSONS = new Set('انھوں انہوں انھیں انہیں ہم تم آپ میں اس ان جس جن کسی سب لوگوں بچوں بچے بچہ لڑکا لڑکی لڑکے آدمی لوگ'.split(' ').map(plain));
function personsIn(text) {
  const w = plain(text).split(' ');
  return new Set(w.filter((x, i) => [...x].length >= 3 && !STOP.has(x) && !NOT_PERSONS.has(x) && !NAME_AFTER.has(x)
    && !NAME_BEFORE.has(x) && (NAME_AFTER.has(w[i + 1]) || NAME_BEFORE.has(w[i - 1]))));
}
function nameInKey(q, by) {
  if (!Array.isArray(q.options) || q.options.length < 2 || WORD_ASK.test(plain(q.question))) return false;
  const key = plain(keyOption(q));
  const words = key.split(' ').filter(Boolean);
  if (words.length < 2) return false;
  const own = new Set(plain(q.question).split(' '));
  const others = q.options.map((o) => plain(String(o).replace(OPTION_HEAD, ''))).filter((o) => o !== key);
  const told = Array.isArray(by.options) && by.options.length ? plain(keyOption(by)) : '';
  const persons = personsIn(`${String(by.question || '').replace(QUOTE_SPAN, ' ')} ${told !== key ? told : ''}`);
  return words.some((w) => persons.has(w) && !own.has(w) && !others.some((o) => ` ${o} `.includes(` ${w} `)));
}
// Urdu Q1: a رموزِ اوقاف item keyed on a mark its own stem ends with («… سوال پوچھنے پر کون سی علامت
// لگائی جاتی ہے؟» → ؟). The item asks the mark of a sentence printed without it.
const MARK_FOLD = { '?': '؟', '.': '۔', ',': '،', ';': '؛' };
const asMark = (t) => [...String(t || '').replace(/\s+/g, '')].map((c) => MARK_FOLD[c] || c).join('');
function markEndsStem(q) {
  if (!Array.isArray(q.options) || !q.options.length) return false;
  const key = asMark(keyOption(q));
  return Boolean(key) && !/[\p{L}\p{N}]/u.test(key) && asMark(q.question).endsWith(key);
}
// Urdu Q1: two options that are one word («مَن» and «من۔»: the same letters once its marks and
// punctuation are set aside, one of them written without marks), the key one of them, are two right
// answers; two wrong options alike leave one right answer («عرض» / «عَرَض» beside «ارض»). Two words
// that differ only by their marks, each written with them («مَن» / «مِن», «سَحَر» / «سِحر»), are two words.
const MARKED = new RegExp(UR_MARKS.source);
function twoRightOptions(q) {
  if (!Array.isArray(q.options) || q.options.length < 2) return false;
  const read = q.options.map((o) => {
    // Letters as written: a spelling item's options differ by one letter (ذائقہ / ذایقہ), never folded.
    const t = String(o).replace(OPTION_HEAD, '').normalize('NFC');
    const bare = t.replace(new RegExp(UR_MARKS.source, 'g'), '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
    return { bare, marks: MARKED.test(t) ? t.replace(/[^\u064B-\u065F\u0670]/g, '') : '' };
  });
  const at = keyAt(q);
  const k = read[at];
  return Boolean(k && k.bare) && read.some((b, j) => j !== at && b.bare === k.bare && !(k.marks && b.marks && k.marks !== b.marks));
}
// Urdu Q1: one grammar concept once on the paper. An item asks a concept when its key is the term
// (… کیا کہلاتا ہے؟ → اسم معرفہ), when its stem names the term outside a quoted example (… میں
// اسم معرفہ کون سا ہے؟), or when its stem or key says what the term is («… خاص نام کے بجائے … عام
// چیز …» → اسکول; «… ایک ہی املا …»). The named noun and the common noun are one rule (خاص / عام).
// A word meaning or a story fact asks no grammar concept. The متشابہ pair is one concept however the
// stem asks it: one spelling with two meanings, two words that sound alike but are spelt apart
// («آواز میں ایک جیسے مگر املا میں مختلف»), a word's «دوسرا معنی», «X بمعنی … اور Y بمعنی …». An
// item that asks which word tells a thing's quality («… کون سا لفظ خوبی بیان کر رہا ہے؟») asks صفت, and
// one that asks the word whose quality is told («جس چیز کی خوبی …») asks موصوف. An antonym or a synonym
// item («"X" کا متضاد / مترادف / الٹ کون سا لفظ ہے؟») is a concept on every scope: on chosen lessons
// that do not teach it (lessons 4–5 do), it is grammar from another lesson.
// Each row is written as the book writes it and folded as plain() folds the text it reads (آ as ا,
// ئ as ی, …), so no row can be dead for a letter form.
const foldPattern = (re) => new RegExp(UR_FORMS.reduce((src, [f, to]) => src.replace(new RegExp(f.source, 'g'), to), re.source.replace(UR_MARKS, '')), re.flags);
const CONCEPTS = [
  ['naming', /(?:^| )(?:اسم )?(?:معرفہ|نکرہ)(?: |$)|اسم (?:خاص|عام)|خاص (?:شخص|نام)|مخصوص نام|عام (?:چیز|نام)/],
  ['sound', /اسم صوت|آواز (?:کو )?ظاہر/],
  ['tool', /اسم آلہ|ہتھیار یا اوزار|اوزار کا نام/],
  ['place', /اسم ظرف/],
  ['adjective', /اسم صفت|(?:^| )صفت(?: |$)|خوبی بیان (?:کر|کرتا|کرتی|کرتے)(?: |$)/],
  ['qualified', /موصوف|جس چیز کی خوبی/],
  ['conjunction', /حرف عطف|(?:^| )عطف(?: |$)|جوڑت[ےا]|جوڑنے/],
  ['condition', /حرف (?:شرط|جزا)|شرط و جزا/],
  ['doubt', /شکیہ|شک (?:و شبہ|ظاہر|کا اظہار)/],
  ['wish', /تمنائی|آرزو (?:کا اظہار|ظاہر)/],
  ['homograph', new RegExp(`${HOMOGRAPH.source}|آواز میں ایک (?:جیسے|جیسا)|دوسرا معنی|بمعنی .+ اور (?:.+ )?بمعنی`)],
  ['antonym', /متضاد|مخالف معنی|الٹ(?:ا|ے)? (?:معنی|مطلب)|کا الٹ(?: |$)/],
  ['synonym', /مترادف|ہم معنی/],
].map(([name, re]) => [name, foldPattern(re)]);
const LESSON_ONLY = new Set(['antonym', 'synonym']);
// The holds a grammar concept may make (a repeat, or a tag the stem contradicts).
const GRAMMAR_REPEAT = new Set(['concept_repeat', 'concept_tag_disagrees']);
// `lessons` is read by no row today: a concept is the same on every scope.
// eslint-disable-next-line no-unused-vars
function conceptOf(q, lessons = null) {
  if (!Array.isArray(q.options) || !q.options.length) return null;
  const read = [plain(keyOption(q)), plain(String(q.question || '').replace(QUOTE_SPAN, ' '))];
  const found = CONCEPTS.find(([, re]) => read.some((t) => re.test(t)));
  return found ? found[0] : null;
}
// Urdu Q1 on chosen lessons: the concept Section A says an item asks (its `concept`, never printed),
// read as a CONCEPTS name or a lesson's grammar name; `grammar: false` for vocabulary, a word
// meaning, comprehension, or a name the table does not hold.
function declaredConcept(tag, P) {
  const t = plain(String(tag || ''));
  if (!t) return null;
  // A lesson entry that names two concepts («تمنائی اور شکیہ جملے», «صفت و موصوف»): the tag says the
  // item asks one of them, and the stem says which.
  const pair = (P.lessons || []).flatMap((l) => l.grammar).find((x) => (x.tags || []).length > 1 && t.includes(plain(x.ur)));
  if (pair) return { name: plain(pair.ur), grammar: true, pair: true };
  const row = CONCEPTS.find(([, re]) => re.test(t));
  if (row) return { name: row[0], grammar: true };
  const g = (P.lessons || []).flatMap((l) => l.grammar)
    .find((x) => { const u = plain(x.ur); return t.includes(u) || (u.startsWith(t) && [...t].length >= 4); });
  return g ? { name: plain(g.ur), grammar: true } : { name: null, grammar: false };
}
// The lesson grammar entry a concept name belongs to (a tag, or the entry's own name).
const entryOf = (lessons, name) => lessons.flatMap((l) => l.grammar).find((g) => (g.tags || []).includes(name) || plain(g.ur) === name) || null;
// Why a declared concept cannot print on these lessons: a concept they do not teach (or Q4's), or one
// the stem itself contradicts. Null when it may.
function declaredMiss(q, d, lessons) {
  if (!d) return null;
  const own = entryOf(lessons, d.name);
  if (d.grammar && (!own || own.q4)) return 'concept_tag_outside';
  const c = conceptOf(q, lessons);
  if (c && (!d.grammar || entryOf(lessons, c) !== own)) return 'concept_tag_disagrees';
  return null;
}
// The lessons a chapter or pages paper covers (P.lessons, by number or by any page they share), or
// null: the full syllabus, a subject without a lesson table, or a scope that names none of them.
function scopeLessons(P, scope) {
  if (!P || !Array.isArray(P.lessons) || !scope || (scope.kind !== 'chapters' && scope.kind !== 'pages')) return null;
  const ranges = (text) => String(text || '').split(',').map((part) => part.split('-').map((n) => Number(n.trim())))
    .filter(([a]) => Number.isFinite(a)).map(([a, b]) => [a, Number.isFinite(b) ? b : a]);
  const chapters = scope.kind === 'chapters' && Array.isArray(scope.chapters) ? scope.chapters.map(Number) : [];
  const pages = ranges(scope.pages);
  const chosen = chapters.length
    ? P.lessons.filter((l) => chapters.includes(l.lesson))
    : P.lessons.filter((l) => ranges(l.pages).some(([a, b]) => pages.some(([c, d]) => a <= d && c <= b)));
  return chosen.length ? chosen : null;
}
// Urdu Q1 on lessons that hold one prose story (lessons 6–7: a story and a poem; any single lesson; pages
// inside one lesson): twenty items drawn from one story name each other's people and things, so at most
// eight ask a fact of the story and the rest come from the lessons' word lists, meanings, idioms and
// poem. Section A says where each item comes from (its `source`, never printed).
const STORY_ITEMS = 8;
const oneStory = (lessons) => Boolean(lessons) && lessons.filter((l) => !l.poem).length <= 1;
// A story item by its stem alone, as a short hash (no text): a paper laid out again from a laid one has
// lost its tags, and `_layout.story_ids` tells the layout which of its printed items ask the story.
const storyId = (q) => {
  let h = 0x811c9dc5;
  for (const c of plain(q.question)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
};
// Urdu Q1 on chosen lessons: the grammar concept an item asks, when it is not one those lessons teach.
function outsideLessons(q, lessons) {
  const concept = lessons && conceptOf(q, lessons);
  if (!concept) return null;
  return lessons.some((l) => l.grammar.some((g) => (g.tags || []).includes(concept))) ? null : concept;
}
function sameQuestion(a, b) {
  const [sa, sb] = [plain(a.question), plain(b.question)];
  if (!sa || !sb) return false;
  const opts = (q) => (Array.isArray(q.options) ? q.options.map((o) => plain(String(o).replace(OPTION_HEAD, ''))).sort().join('|') : '');
  if (opts(a) !== opts(b)) return false;
  if (sa === sb) return true;
  if (!opts(a)) { const k = writtenKey(a.question); return Boolean(k) && k === writtenKey(b.question); }
  if (!opts(a) || plain(keyText(a)) !== plain(keyText(b))) return false;
  const [A, B] = [new Set(sa.split(' ')), new Set(sb.split(' '))];
  const differ = [...A].filter((w) => !B.has(w)).concat([...B].filter((w) => !A.has(w)));
  return differ.every((w) => FRAME_WORDS.has(w));
}
// Social Studies: Section A's top-up, when Q1 items were held because a C/D stem gives them away
// (givenBack), is told every C/D question and those items: a re-ask told nothing keys the same name again.
const SELF_RULES = new Set(['key_in_own_stem', 'names_q1_key']);
// The laid-out items of one slot, with a question line.
function itemsOf(examJson, slotId) {
  const out = [];
  for (const types of Object.values((examJson && examJson.unseen) || {})) {
    for (const list of Object.values(types || {})) {
      if (Array.isArray(list)) out.push(...list.filter((q) => q && q.slot === slotId && typeof q.question === 'string' && q.question.trim()));
    }
  }
  return out;
}
function backNote(section, examJson, held) {
  if (!section.slots.some((s) => s.slot === SST_A_Q1)) return null;
  const ofA = (rules) => (Array.isArray(held) ? held : []).filter((h) => h && h.slot === SST_A_Q1 && rules.has(h.rule) && h.q && typeof h.q.question === 'string');
  const line = ({ q }) => `- ${q.question.trim()} → ${keyText(q).trim()}`;
  const set = ofA(BACK_RULES);
  const self = ofA(SELF_RULES);
  const notes = [];
  if (set.length) {
    const asked = ['social_studies.C.Q5', Q6_SLOT, 'social_studies.D.Q7'].flatMap((id) => itemsOf(examJson, id)).map((q) => `- ${q.question.trim()}`);
    notes.push(`${asked.length ? `Sections C and D of this paper ask these questions:\n${asked.join('\n')}\n` : ''}`
      + `These Q1 items were set aside, because one of those questions prints their answer or asks the same thing:\n${set.map(line).join('\n')}\n`
      + 'No Q1 item may be keyed on a name, term, year or number those questions print, or ask what any of them asks.');
  }
  if (self.length) {
    notes.push(`These Q1 items were set aside, because a Q1 question names their answer:\n${self.map(line).join('\n')}\n`
      + 'A Q1 question never names its own answer, nor the answer of another Q1 item.');
  }
  return notes.length ? notes.join('\n\n') : null;
}
// Social Studies: the Q6 items set aside as book-fact recall (asksRecall, namesBody), and what a Q6 is instead.
const RECALL_RULES = new Set(['recall', 'names_body', 'asks_frame', 'tells_what', 'book_list']);
// Social Studies: the held items of a section's slots (`held` from applyLayout), never these.
function heldNote(section, held) {
  const own = new Set(section.slots.map((s) => s.slot));
  const lines = (Array.isArray(held) ? held : []).filter((h) => h && !RECALL_RULES.has(h.rule) && h.rule !== 'key_in_own_stem' && own.has(h.slot) && h.q && typeof h.q.question === 'string' && h.q.question.trim())
    .map(({ q }) => {
      const points = (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
        .map((p) => (typeof p === 'string' ? p : p && p.text)).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
      const key = keyText(q).trim();
      return `- ${q.question.trim()}${key ? ` → ${key}` : ''}${points.length ? `\n  points: ${points.join('; ')}` : ''}`;
    });
  if (!lines.length) return null;
  return `These items were set aside, because a child answering this paper's other items would already have answered them:\n${lines.join('\n')}\n`
    + 'Never these: write none of them again, and no item answered by any of these answers or points, in any wording.';
}

module.exports = {
  CONCEPTS, GRAMMAR_REPEAT, LESSON_ONLY, RECALL_RULES, STORY_ITEMS, backNote, conceptOf, declaredConcept,
  declaredMiss, entryOf, heldNote, itemsOf, markEndsStem, nameCue, nameInKey, oneStory, outsideLessons,
  sameQuestion, scopeLessons, storyCue, storyId, twoRightOptions,
};
