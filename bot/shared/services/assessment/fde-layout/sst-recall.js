'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { printedIn, sentencesOf } = require('./fact-twins');
const { verseLines } = require('./scope-frames');
const { ONE_LINE, UR_FORMS, UR_MARKS, keyText, plain, textsOf, tokensOf } = require('./stem-tags');

// Social Studies, which government does a job (the book's table, p.29). A key that gives one row's
// job to another government is a wrong key, not a repeat: it is held before the re-ask and never
// comes back. Read sentence by sentence: a sentence that names one government («… حکومت») gives it
// the jobs it lists, and one that opens with «وہ» or «یہ» carries the sentence before's government
// («اس کے برعکس» does not). A sentence that names two governments (one of them by its short name,
// «وفاق», «صوبہ») compares them, and one that says «نہیں» denies a job: neither is judged. A short
// key that names one government is read with its stem. The jobs are the table's own cell words, as
// phrases («ملکی دفاع», not «شہری دفاع»; «امن و امان کا قیام», not a wish for peace).
const TIER_NAMES = { وفاقی: 'federal', صوبائی: 'provincial', مقامی: 'local' };
const TIER_JOBS = {
  federal: ['ملکی دفاع', 'مسلح افواج', 'ملکی معیشت', 'خارجہ پالیسی'],
  provincial: ['تجاوزات', 'امن و امان کا قیام', 'صوبائی محصولات', 'داخلی پالیسی'],
  local: ['مویشی منڈی', 'عوامی میلے', 'نکاسی', 'پینے کے پانی', 'پینے کا پانی', 'بیواؤں', 'یتیموں', 'معذوروں'],
};
const flatUr = (text) => {
  let t = String(text == null ? '' : text).normalize('NFC').replace(UR_MARKS, '');
  for (const [re, to] of UR_FORMS) t = t.replace(re, to);
  return t.replace(/[\s​-‏]+/g, '');
};
const TIER_JOB_FLAT = Object.fromEntries(Object.entries(TIER_JOBS).map(([tier, jobs]) => [tier, jobs.map(flatUr)]));
const TIER_RE = new RegExp(`(${Object.keys(TIER_NAMES).map(flatUr).join('|')})حکومت`, 'g');
const CARRIES = /^\s*(?:وہ|یہ|یہی|وہی)\s/;
// A government named by its short name: «وفاق», «صوبہ / صوبے / صوبوں» (never «صوبائی»).
const TIER_SHORT = new Map([['وفاق', 'federal'], ['صوبہ', 'provincial'], ['صوبے', 'provincial'], ['صوبوں', 'provincial']].map(([w, t]) => [plain(w), t]));
const shortTiers = (sentence) => new Set(plain(sentence).split(' ').map((w) => TIER_SHORT.get(w)).filter(Boolean));
const tiersIn = (flat) => new Set([...flat.matchAll(TIER_RE)].map((m) => TIER_NAMES[Object.keys(TIER_NAMES).find((n) => flatUr(n) === m[1])]));
const jobsOf = (flat, tier) => TIER_JOB_FLAT[tier].some((j) => flat.includes(j));
const otherJob = (flat, tier) => Object.keys(TIER_JOB_FLAT).some((t) => t !== tier && jobsOf(flat, t));
function tierSlipIn(text) {
  let carry = null;
  for (const sentence of String(text || '').split(/[۔.!?؟\n]+/)) {
    const flat = flatUr(sentence);
    if (!flat) continue;
    const named = tiersIn(flat);
    const all = new Set([...named, ...shortTiers(sentence)]);
    if (all.size > 1 || /نہیں/.test(sentence)) { carry = null; continue; }
    const tier = named.size === 1 ? [...named][0] : (!all.size && CARRIES.test(` ${sentence.trim()} `) ? carry : null);
    carry = tier;
    if (tier && otherJob(flat, tier)) return true;
  }
  return false;
}
function tierSlip(q) {
  const scheme = q.scheme && typeof q.scheme === 'object' ? q.scheme : {};
  const points = Array.isArray(scheme.points) ? scheme.points.map((p) => p && p.text) : [];
  const accept = Array.isArray(scheme.accept) ? scheme.accept : [];
  if (textsOf(q.answer, points, accept).some(tierSlipIn)) return true;
  // «سڑکوں سے تجاوزات ہٹانا کس حکومت کا کام ہے؟ → مقامی حکومت»
  const key = flatUr(keyText(q));
  const keyed = tiersIn(key);
  if (keyed.size !== 1 || tokensOf(keyText(q)).length > ONE_LINE) return false;
  const tier = [...keyed][0];
  const stem = flatUr(q.question);
  return tiersIn(stem).size === 0 && !jobsOf(stem, tier) && otherJob(stem, tier);
}

// Social Studies Q6: a situation whose questions ask only book facts. FDE's Q6 brings a book idea
// to a case the book does not answer; who heads or chairs a body, what it is called, how many, when
// and what was done are Remember wherever they sit, and belong in Q7. Each asking clause of the stem
// is read: one that asks the child to decide, advise or act on the case (apply) or to give a reason,
// effect or comparison (explain) keeps the item; «which government does this job» is the case put to
// a book idea, and keeps it too. Held: two or more book-fact clauses, none to apply, and more facts
// than reasons («ریاستی مذہب کیوں اسلام ہے» beside «قومی زبان کیا ہے» keeps an item).
const Q6_SLOT = 'social_studies.D.Q6';
const ASK_WORDS = new Set(['کون', 'کونسا', 'کونسی', 'کیا', 'کیوں', 'کیسے', 'کتنے', 'کتنی', 'کتنا', 'کب', 'کہاں', 'کس', 'کن']);
const FACT_WORDS = new Set(['کون', 'کونسا', 'کونسی', 'کتنے', 'کتنی', 'کتنا', 'کب', 'کہاں', 'کس', 'کن']);
const ASKS = /بتائیں|بتاؤ|لکھیں|وضاحت|سمجھائیں|بیان کریں|جواب دیں|پوچھت|جاننا چاہت/;
const APPLIES = /چاہیے|چاہئے|چاہییں|مشورہ|مشورے|مشوروں|رائے دیں|بتائیں کہ وہ کیا کرے|تجویز|اقدام|طریق|مراحل|اپنائیں|کرائیں|کریں گے|سکتے ہیں|سکتی ہے|سکتا ہے|ہوتے تو|فیصلہ کریں|منتخب کرے|لاگو|درست ہے|صحیح ہے|مناسب|استعمال|انتظامات|اپنا حل/;
const EXPLAINS = /کیوں|وجہ|اثر|فائدہ|فائدے|نقصان|اہمیت|ضروری|فرق|موازنہ|جیسے|مشابہ|ملتا|ملتی|مختلف|خوبی|کیسے(?!\s*(چنا|چنے|چنی|منتخب))/;
const WHICH_TIER = /(کون|کس)\s+(کس\s+)?(سی\s+|سا\s+)?(کام\s+)?(سطح\s+(کی\s+)?)?(مقامی\s+|صوبائی\s+|وفاقی\s+)?حکومت/;
const DONE = /^(تھا|تھی|تھے|کیا|کی|کیے|اٹھایا|دیا|گیا|گئی|گئے|ہوا|ہوئی)$/;
const askTokens = (text) => text.replace(/[؟?!۔،,:؛«»"'()]/g, ' ').split(/\s+/).filter(Boolean);
function factClause(clause) {
  const t = askTokens(clause);
  if (t.some((w) => FACT_WORDS.has(w))) return true;
  if (/کیسے\s+(چنا|چنے|چنی|منتخب)/.test(clause)) return true;
  const k = t.lastIndexOf('کیا');
  if (k < 0) return false;
  const after = t.slice(k + 1);
  if (after[0] && /^کہلات/.test(after[0])) return true;
  if (after.length && after.length <= 2 && after.every((w) => /^(ہے|ہیں|ہوگا|ہوگی)$/.test(w))) return true;
  return after.length > 0 && DONE.test(t[t.length - 1]);
}
function asksRecall(q) {
  const sentences = String((q && q.question) || '').split(/(?<=[۔؟?!])|\n/).map((x) => x.trim()).filter(Boolean);
  let facts = 0;
  let reasons = 0;
  for (const sentence of sentences.filter((x) => /[؟?]$/.test(x) || ASKS.test(x))) {
    for (const clause of sentence.split(/[،,]|\sاور\s|\sکہ\s/).map((x) => x.trim()).filter(Boolean)) {
      if (!askTokens(clause).some((w) => ASK_WORDS.has(w)) && !ASKS.test(clause)) continue;
      if (APPLIES.test(clause)) return false;
      if (EXPLAINS.test(clause)) reasons += 1;
      else if (!WHICH_TIER.test(clause) && factClause(clause)) facts += 1;
    }
  }
  return facts >= 2 && facts > reasons;
}

// Social Studies Q6: a story that only relays a child's question («بلال نے پوچھا کہ زلزلہ کیا ہوتا ہے …
// آپ بلال کو مفصل جواب دیں»; «حمزہ جاننا چاہتا ہے کہ صحرا میں کھیتی باڑی کیوں نہیں ہوتی …»): its answer is
// the book's text in order, a Q5 in a story. The relayed question is read apart from the rest of the
// stem, so what it asks («… کیا کرنا چاہیے») is not a decision the child makes. Held when no sentence
// outside it asks the child to decide or advise. «بغیر پوچھے» relays nothing. A relay may end in a colon
// («علی نے استاد سے پوچھا: زلزلہ کیا ہوتا ہے …؟»), and what the child is asked may follow it in the same
// sentence, after a comma, spoken to the child («…، آپ اسے دو مشورے دیں کہ وہ کیا کرے»).
const RELAYS = /(?:پوچھا|پوچھتا|پوچھتی|پوچھتے|پوچھنا|جاننا\s*چاہت[اےی]|معلوم\s*کرنا\s*چاہت[اےی])(?:\s*(?:ہے|ہیں|تھا|تھی|تھے))?\s*(?:کہ(?:\s|$)|[:：])/;
function asksFrame(q) {
  const sentences = String((q && q.question) || '').split(/(?<=[۔؟?!])|\n/).map((x) => x.trim()).filter(Boolean);
  if (!sentences.some((x) => RELAYS.test(x))) return false;
  const outside = sentences.flatMap((x) => (RELAYS.test(x) ? x.split(/[،,]/).slice(1).filter((c) => /^\s*آپ\s/.test(c)) : [x]));
  return !outside.some((x) => APPLIES.test(x));
}

// Social Studies Q6: a story that only asks the child to tell someone what a place or a system is like
// («زارا کو بتائیں کہ وہاں موسم کیسا ہو گا …», «دونوں نظاموں کا موازنہ کرتے ہوئے بتائیں کہ … کون سی سہولتیں …»):
// its answer is the book's description in order, a Q5 in a story. Held when nothing in it asks the child to
// decide or advise (what someone should do, whom to turn to: «کیا کرنا چاہیے», «مشورے», «کس سے بات کرے»).
const TELLS = /کو\s+بتائیں\s+کہ[^۔؟?!]*(?:کیسا|کیسی|کیسے|کیا|کون\s*سی|کون\s*سے|کون\s*سا)|موازنہ\s+کرتے\s+ہوئے\s+بتائیں\s+کہ/;
// An instruction to the child («وضاحت کریں», «بیان کریں») decides nothing, so a subjunctive right after one is no
// decision; «کیسے … کر سکتا ہے» asks the child how someone can help, which is advice.
const DECIDES = /مشورہ|مشورے|مشوروں|رائے دیں|فیصلہ|تجویز|اقدام|کیا کرے|کیا کریں|کیا کرنا|(?:کرنا|کرنی|کرنے)\s*چاہی|کیسے[^۔؟?!]{0,40}سکت[اےی]|(?<!(?:وضاحت|بیان|تحریر|واضح)\s*)(?:رکھے|کرے|کریں|اپنائے|کہے)(?![\p{L}])(?!\s*(?:سکت|گا|گی|گے))/u;
function tellsWhat(q) {
  const stem = String((q && q.question) || '');
  return TELLS.test(stem) && !DECIDES.test(stem);
}

// Social Studies: a Q6 whose answer only names who does a job («تجاوزات ہٹانے کے لیے صوبائی حکومت کا
// درست نام», «سب سے بڑی عدالت سپریم کورٹ کا ذکر») is recall in a story, even with the book's line for
// a reason: an Apply item's answer explains with two ideas or more. Read on the marking points: an
// item that asks which government, court or body («کون سی حکومت», «کس ادارے», «کیا کہتے ہیں»), or
// marks one by name («… کے لیے صوبائی حکومت کا درست نام»), is held when fewer than two of its points
// explain without naming a government, court or body, and without being only how it is marked.
// A point that says which government does a job («… صوبائی حکومت کا کام ہے», «… مدد مقامی حکومت
// کرتی ہے») names it as surely as «… کا نام» does, and a province («صوبہ», «صوبے») is a body too.
const BODY = /(?:وفاقی|صوبائی|مقامی|ضلعی)\s*(?:حکومت|اسمبلی)|عدالت|کورٹ|اسمبلی|سینی?ٹ|مقننہ|انتظامیہ|عدلیہ|پارلیمان|پارلیمنٹ|الیکشن کمیشن|کابینہ|(?:^|\s)صوب(?:ہ|ے)(?:\s|$|۔)/;
const WHICH_BODY = /(?:کون|کس)[^؟?۔،]{0,16}(?:حکومت|ادارے|ادارہ|عدالت|حصے|سطح|اعضا|ایوان)|کون\s*(?:کرے|کرتا|کرتی|دیکھے|دیکھتا|دیکھتی|طے)/;
const CALLED = /کیا\s*(?:کہتے|کہلات)|کو\s*کیا\s*کہا\s*جاتا/;
const NAMING = /(?:^|\s)(?:نام|نشان\s*دہی|نشاندہی|پہچان|پہچاننا|شناخت)(?:\s|$|۔)/;
const DOES_JOB = /حکومت(?:وں)?\s*(?:کا\s*کام|کی\s*ذمہ\s*داری)|حکومت(?:یں)?\s*(?:کرتی|کرتا|دیکھتی|دیکھتا)/;
const names = (t) => NAMING.test(t) || DOES_JOB.test(t);
const EXPLAINING_POINTS = 2;
const PLACEHOLDER_WORDS = new Set(tokensOf('پہلی پہلا دوسری دوسرا تیسری تیسرا ایک دو ہر درست وجہ وجوہات فائدہ فوائد اثر اثرات '
  + 'وضاحت مربوط واضح مکمل مناسب نکتہ نکات خصوصیت بیان کرنا اقدام فعل مثال نقصان بتانا بتایا لکھنا لکھی لکھا ذکر جملوں جملہ صحیح'));
const FACT_WORDS_MIN = 2;
// A point states a fact when it has two words that are not marking words, or when every word in it
// is one (a name, like «مقننہ»).
const statesFact = (text) => {
  const words = tokensOf(text);
  const facts = words.filter((w) => !PLACEHOLDER_WORDS.has(w)).length;
  return facts >= FACT_WORDS_MIN || (facts > 0 && facts === words.length);
};
function namesBody(q) {
  const points = (q && q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
    .map((p) => String(typeof p === 'string' ? p : (p && p.text) || ''));
  const stem = String((q && q.question) || '');
  if (!points.some((t) => names(t) && BODY.test(t)) && !WHICH_BODY.test(stem) && !CALLED.test(stem)) return false;
  return points.filter((t) => !BODY.test(t) && !names(t) && statesFact(t)).length < EXPLAINING_POINTS;
}

// Social Studies Q6: an answer that is a list the book gives (a party's jobs, a quarrel settled by the book's
// steps in its own words), set in a story, is recall: the child copies the book. Held when at least three of its
// marking points each restate a sentence of the pages (seven tenths of its words, marking words aside), all within
// three sentences side by side, or within one sentence that lists them. A point that uses a book idea in the
// story's own words is not a restatement: an Apply item's points carry the book's ideas too, so the test asks
// for the book's wording, in the book's order.
const LIST_POINTS = 3;
const LIST_SPAN = 2;
const LIST_SHARE = 0.7;
let backGeneric = new Set(tokensOf('حکومت ملک کام پاکستان ادارہ ادارے لوگ لوگوں کسی کوئی نام کرنا معاملات علاقہ علاقے شخص شخصیت سال'));
// The sentences that hold `words` (at least two of them, and at least half), by index: a fact the book states
// twice (its lesson, then its exercise) sits in both.
const PASSAGE_WORDS = 2;
function bookList(q, sentences) {
  if (!sentences) return false;
  const at = (q && q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
    .map((p) => [...new Set(tokensOf(String(typeof p === 'string' ? p : (p && p.text) || '')))].filter((w) => !PLACEHOLDER_WORDS.has(w) && !backGeneric.has(w)))
    .filter((words) => words.length >= PASSAGE_WORDS)
    .map((words) => sentences.flatMap((s, i) => (words.filter((w) => s.has(w)).length >= LIST_SHARE * words.length ? [i] : [])))
    .filter((list) => list.length);
  if (at.length < LIST_POINTS) return false;
  return [...new Set(at.flat())].some((from) => at.filter((list) => list.some((i) => i >= from && i <= from + LIST_SPAN)).length >= LIST_POINTS);
}

// Urdu: a Q1 MCQ keyed on a word of a Q6 verse line it asks about: its key's words are all in the
// line and its stem carries at least two of the line's other words («ندی کا پانی صاف ہو گا تو ہم کس
// چیز سے بچیں گے؟ → بیماری» beside «پانی جو صاف ہوگا بیماری سے بچوگے»), or it quotes a line. A
// key the verse merely shares («اور», «رات») with a stem about something else is no twin.
const VERSE_ASKS = 2;
function verseTwin(q6s) {
  const lines = q6s.flatMap((q) => verseLines(q.passage).lines);
  if (!lines.length) return null;
  const read = lines.map((l) => ({ tokens: new Set(tokensOf(l)), words: plain(l).split(' ') }));
  return (q) => {
    const key = tokensOf(keyText(q));
    const stem = [...new Set(tokensOf(q.question))].filter((w) => !key.includes(w));
    if (key.length && read.some((l) => key.every((w) => l.tokens.has(w)) && stem.filter((w) => l.tokens.has(w)).length >= VERSE_ASKS)) return true;
    return sentencesOf(q, false).some((t) => read.some((l) => printedIn(t, l.words)));
  };
}

// Urdu: a Q1 MCQ about a word Q3 (meanings) or Q5 (sentences) lists: its stem names the word and
// asks its meaning, or it is keyed on the meaning Q3's own answer gives it («اقتصادی» → «معاشی
// حالت سے» beside Q3's «اقتصادی: معاشی، …»). A Q1 item asking a listed word's opposite or its kind
// of noun, keyed on something else, stays. Read the other way, an item that gives the meaning in its
// stem and is keyed on a listed idiom («بہت زیادہ غصے میں آ جانا» → آگ بگولا ہونا, beside Q5's «آگ
// بگولا ہونا»; → شرم سے پانی پانی ہونا beside «پانی پانی ہونا») is the same twin: a key of two words
// or more that holds, or sits inside, a listed word of two words or more. A one-word key («پانی»)
// inside a listed idiom stays.
const MEANING_ASK = /مطلب|معنی|معانی|مراد|مفہوم/;
// An idiom read without the form of its verb: a trailing «جانا/ہونا/کرنا/دینا» is dropped and a
// «…انا» verb left last is cut to its root («مچانا» → «مچ»), so «دھوم مچ جانا» and «دھوم مچانا» are one
// idiom («دھوم مچ»), and «شور مچ جانا» another. A plain «…نا» verb is not cut: «دل لگنا» is not «دل
// لگانا». Two words at least, and a verb form actually set aside: a phrase with no verb («دھوم دھام»)
// is matched as written.
const LIGHT_VERBS = new Set(['جانا', 'ہونا', 'کرنا', 'دینا']);
function idiomOf(text) {
  const w = plain(text).split(' ').filter(Boolean);
  let cut = false;
  while (w.length > 2 && LIGHT_VERBS.has(w[w.length - 1])) { w.pop(); cut = true; }
  if (w.length < 2) return '';
  const root = w[w.length - 1].replace(/انا$/, '');
  if (root.length >= 2 && root !== w[w.length - 1]) { w[w.length - 1] = root; cut = true; }
  return cut ? w.join(' ') : '';
}
// Every idiom a stem prints, read as above: each run of two to six of its words.
function idiomsIn(text) {
  const w = plain(text).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i < w.length; i += 1) {
    for (let n = 2; n <= 6 && i + n <= w.length; n += 1) { const id = idiomOf(w.slice(i, i + n).join(' ')); if (id) out.add(id); }
  }
  return out;
}
// A Q3/Q5 entry and a Q1 stem read without the form of their verb, for the meaning hold only: a
// trailing «ہے / ہیں / تھا / رہا / رہی / رہے / گیا / ہونا / جانا / کرنا …» is dropped and «نا» is cut
// off a last word of four letters or more («دم گھٹ رہا ہے» and «دم گھٹنا» are «دم گھٹ»; «دل لگ رہا ہے» is
// «دل لگ» and «دل لگانا» «دل لگا»). An entry with no verb form to set aside is matched as written.
const FOLD_TAIL = new Set('ہے ہیں تھا تھی تھے ہو رہا رہی رہے گا گی گے گیا گئی گئے جاتا جاتی جاتے ہونا جانا کرنا دینا'.split(' '));
function stemFold(text) {
  const w = plain(text).split(' ').filter(Boolean);
  let cut = false;
  while (w.length > 2 && FOLD_TAIL.has(w[w.length - 1])) { w.pop(); cut = true; }
  if (w.length >= 2 && FOLD_TAIL.has(w[w.length - 1])) { w.pop(); cut = true; }
  if (w.length < 2) return '';
  const last = w[w.length - 1];
  if (/نا$/.test(last) && [...last].length >= 4) { w[w.length - 1] = last.slice(0, -2); cut = true; }
  return cut ? w.join(' ') : '';
}

module.exports = {
  BODY, MEANING_ASK, PASSAGE_WORDS, PLACEHOLDER_WORDS, Q6_SLOT, asksFrame, asksRecall, backGeneric, bookList,
  flatUr, idiomOf, idiomsIn, namesBody, statesFact, stemFold, tellsWhat, tierSlip, tiersIn, verseTwin,
};
