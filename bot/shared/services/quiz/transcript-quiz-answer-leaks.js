'use strict';
/**
 * ONE QUESTION GIVING AWAY ANOTHER'S ANSWER (quiz_author_gates_v2).
 *
 * Every other check looks at one question at a time. The red team's blind
 * re-score of ten real sources (5 Oct 2026) found a later question's answer
 * stated by an earlier one in 8 of 10 quizzes: an earlier stem asks "Why is
 * 4/8 the same as 1/2?" before a later one asks what fraction 4 of 8 parts is;
 * a wrong option's feedback says "denominator is the number at the bottom"
 * before the next question asks what the bottom number is called; a wrong
 * option reads "A desert fox hunts at night" (its feedback: "a behavioural
 * adaptation") before "Which is a behavioural adaptation of a desert fox?".
 * The child is not tested on the second; the class report counts it.
 *
 * WHAT COUNTS. The child plays the questions in order and, after each one,
 * reads its explanation and the line for the option they chose. A LATER
 * question j leaks from an EARLIER question i when ONE SENTENCE of what i shows
 * — its stem, any of its options, its explanation, its "right" line, the
 * feedback of any of its wrong options — states j's answer:
 *   - WORDS: the sentence carries j's answer's content words (all of them for
 *     an answer of one or two words; seven in ten for a longer one — "the
 *     smaller each part becomes" states "Each part gets smaller"), English
 *     words compared by their stem (hunts / hunting, migrate / migrating);
 *   - NUMBERS: an answer that is a number or a fraction is stated when the
 *     sentence carries it together with every number of j's stem ("No,
 *     19 − 7 = 12" before "Subtract 7 from 19"; "Why is 4/8 the same as 1/2?"
 *     before "4 of 8 parts are covered: what fraction?");
 *   - and the sentence names NONE of j's wrong options (a line that lists the
 *     crust, the mantle and the core states an order, not one answer; a wrong
 *     option made of the stem's own numbers does not count);
 *   - a short answer (one or two content words) must also share a topic word
 *     with j's stem: "Which of these is a structural adaptation?" names the
 *     category; it says nothing about the desert fox a later question asks about;
 *   - j's own stem must not offer the answer ("Is this structural or
 *     behavioural?" is a choice, not a fact anything can give away).
 * THE SAME STEM TWICE. A later question whose stem is word for word an earlier
 * one's (with no picture to tell them apart) is the same question, whatever its
 * key says — the G2 Urdu lesson shipped «'اہم میٹنگ' کا کیا مطلب ہے؟» twice,
 * once keyed «ضروری ملاقات» and once «ضروری بات چیت». The precise repeat check
 * (transcript-quiz-duplicates) asks for the same answer; this one does not.
 *
 * MEASURED on the ten re-score quizzes (build w35/k_leaks/measure): see the PR.
 *
 * The complaint names BOTH questions — the LATER one first, so the targeted
 * rewrite gives that slot a question on another fact, and the earlier one with
 * the words that give the answer away, so the rewrite can avoid them. It is a
 * SOFT fault (generate's IN_PLACE_FAULT): a quiz never fails over it.
 */

const { mathToText } = require('./quiz-math');

const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'are', 'was', 'were', 'and', 'or', 'what', 'which', 'who', 'whom',
  'how', 'why', 'when', 'where', 'this', 'that', 'these', 'those', 'it', 'its', 'be', 'by', 'for', 'with', 'as', 'at',
  'from', 'do', 'does', 'did', 'you', 'your', 'one', 'two', 'type', 'kind', 'called', 'name', 'there', 'their', 'they',
  'will', 'would', 'can', 'could', 'should', 'have', 'has', 'had', 'into', 'about', 'than', 'then', 'them', 'also',
  'only', 'not', 'no', 'yes', 'get', 'gets', 'got', 'become', 'becomes', 'make', 'makes', 'more', 'most', 'very', 'just', 'so', 'because', 'if', 'all', 'each', 'every', 'some', 'many', 'much',
  'lesson', 'teacher', 'class', 'example', 'question', 'answer', 'right', 'correct', 'wrong', 'true', 'false',
  'کی', 'کا', 'کے', 'ہے', 'ہیں', 'کو', 'میں', 'سے', 'نے', 'پر', 'اور', 'یا', 'کون', 'کونسا', 'کونسی', 'سا', 'سی',
  'کیا', 'کیوں', 'کیسے', 'کہاں', 'کب', 'یہ', 'وہ', 'ان', 'اس', 'ایک', 'جاتا', 'جاتی', 'جاتے', 'کہا', 'کہتے', 'ہوتا',
  'ہوتی', 'ہوتے', 'لفظ', 'قسم', 'نہیں', 'ہاں', 'بھی', 'تو', 'ہو', 'ہوں', 'تھا', 'تھی', 'تھے', 'گا', 'گی', 'گے', 'جو',
  'جس', 'جب', 'کر', 'کرتا', 'کرتی', 'کرتے', 'کرنا', 'ہم', 'آپ', 'سبق', 'استاد', 'کلاس', 'جواب', 'سوال', 'صحیح', 'غلط',
  'بالکل', 'شاباش', 'درست', 'مثال', 'لیے', 'لئے', 'والا', 'والی', 'والے',
]);
const BINARY = new Set(['yes', 'no', 'true', 'false', 'ہاں', 'نہیں', 'صحیح', 'غلط', 'درست']);
const LATIN = /^[a-z]+$/;

/** Lower-cased tokens, any script; maths flattened; diacritics and direction marks dropped; Eastern digits to Western. */
function tokens(s) {
  const text = String(s ?? '');
  return (text.includes('$') || text.includes('\\') ? mathToText(text) : text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟ‌-‏‪-‮⁦-⁩]/g, '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .match(/[\p{L}\p{N}]+/gu) || [];
}
/** An English word by its stem (hunts, hunting -> hunt; migrate, migrating -> migrat); other scripts as written. */
function stem(w) {
  if (!LATIN.test(w)) return w;
  if (w.length > 4) return w.replace(/(ing|ed|es|s|e)$/, '');
  return w.length === 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w;   // ends -> end, ears -> ear
}
const isNum = (w) => /^\d+$/.test(w);
/** The words that carry meaning: stemmed, function words and quiz filler left out. */
const content = (s) => new Set(tokens(s).filter((w) => !STOP.has(w)).map(stem));
const topical = (w) => !isNum(w) && w.length >= 3;
/** The numbers of a text, as written (a fraction keeps its slash: "1/2"). */
function numbers(s) {
  const text = String(s ?? '');
  const flat = (text.includes('$') || text.includes('\\') ? mathToText(text) : text)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  return flat.match(/\d+(?:\s*\/\s*\d+)?/g)?.map((n) => n.replace(/\s+/g, '')) || [];
}
/** A fraction's parts as well as the fraction: "4/8" -> 4/8, 4, 8. */
const withParts = (nums) => new Set(nums.flatMap((n) => [n, ...n.split('/')]));

function correctList(q) {
  if (Array.isArray(q.correct_indices) && q.correct_indices.length) return q.correct_indices.map(Number);
  if (Array.isArray(q.correct_index)) return q.correct_index.map(Number);
  return [Number(q.correct_index) || 0];
}
const optionsOf = (q) => (Array.isArray(q && q.options) ? q.options.map((o) => String(o ?? '')) : []);
/** How many of `need`'s words must a sentence carry to state it: all of one or two, seven in ten of more. */
const enough = (n) => (n <= 2 ? n : Math.ceil(n * 0.7));
function carries(sentence, want) {
  let hit = 0;
  want.forEach((w) => { if (sentence.has(w)) hit += 1; });
  return want.size > 0 && hit >= enough(want.size);
}

const sentences = (text) => String(text || '').split(/(?<=[.!?۔؟])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

/** Everything question i shows the child, one sentence at a time, each with where it came from. */
function sentencesOf(q) {
  const out = [];
  const add = (where, field, text) => sentences(text).forEach((s) => {
    out.push({ where, field, text: s, words: content(s), raw: new Set(tokens(s)), nums: numbers(s) });
  });
  add('question', null, q.question);
  // its correct option, which the child is told is right — a wrong option is offered, never asserted
  correctList(q).forEach((k) => add('correct option', null, optionsOf(q)[k]));
  add('explanation', ['explanation'], q.explanation);
  const fb = (q.option_feedback && typeof q.option_feedback === 'object') ? q.option_feedback : {};
  if (typeof fb.correct === 'string') add('right line', ['option_feedback', 'correct'], fb.correct);
  const wrong = (fb.wrong && typeof fb.wrong === 'object') ? fb.wrong : {};
  Object.entries(wrong).forEach(([k, t]) => {
    if (typeof t !== 'string') return;
    add('wrong-option feedback', ['option_feedback', 'wrong', k], t);
    // and the option WITH its feedback: «This is a behavioural adaptation, as the fox DOES it» is about
    // the option it answers ("A desert fox hunting at night"), and only the two together say so
    const opt = optionsOf(q)[Number(k)];
    if (opt && opt.trim()) {
      const unit = `${opt.trim()} — ${t.trim()}`;
      out.push({ where: 'wrong-option feedback', field: null, text: unit, words: content(unit), raw: new Set(tokens(unit)), nums: numbers(unit), fb: content(t) });
    }
  });
  if (typeof q.misconception_feedback === 'string') add('wrong-option feedback', ['misconception_feedback'], q.misconception_feedback);
  return out;
}

/** What j asks for, in the forms a sentence could state it, or null when nothing can give it away. */
function targetOf(q) {
  const keys = correctList(q);
  const opts = optionsOf(q);
  if (keys.length !== 1 || !opts[keys[0]]) return null;
  const raw = opts[keys[0]];
  const all = tokens(raw);
  if (!all.length || BINARY.has(all.join(' '))) return null;
  const stemText = q.question || '';
  const stemNums = withParts(numbers(stemText));
  const stemWords = content(stemText);
  const topic = new Set([...stemWords].filter((w) => topical(w)));
  const keyNums = numbers(raw);
  const wrong = opts.map((o, k) => (keys.includes(k) || !o.trim() ? null : o)).filter(Boolean);
  if (keyNums.length) {
    // a picture question's number is about its own picture ("What time is it on the clock?")
    if (hasPicture(q)) return null;
    const stemAsWritten = new Set(numbers(stemText));
    if (keyNums.every((n) => stemAsWritten.has(n))) return null;   // "compare 3/4 and 2/5": the stem offers it
    // a number or a fraction: stated with every number of the stem, never when a wrong option is stated too
    // a stem with no number of its own ("How many syllables in 'famous'?") needs its topic said too
    return {
      kind: 'number', shown: raw, keyNums, stemNums, topic: [...stemNums].length ? null : topic,
      // a wrong option made of the stem's own numbers ("4/8" when 4 of 8 parts are covered) is the trap, not a rival answer
      wrongNums: wrong.map(numbers).filter((n) => n.length && !n.flatMap((x) => x.split('/')).every((x) => stemNums.has(x))),
    };
  }
  // a gloss in brackets is the same answer twice («ٹرف (trough)»): either half states it
  const unglossed = raw.replace(/\s*[(（][^)）]*[)）]\s*/g, ' ').trim();
  const want = content(unglossed) .size ? content(unglossed) : content(raw);
  if (!want.size) return null;
  if ([...want].every((w) => stemWords.has(w))) return null;   // the stem offers it
  return {
    kind: 'words', shown: raw, want, keyRaw: new Set(tokens(raw)),
    topic: new Set([...topic].filter((w) => !want.has(w))),
    wrong: wrong.map((o) => ({ words: content(o), raw: new Set(tokens(o)) }))
      .filter((w) => w.words.size && ![...w.words].every((x) => stemWords.has(x))),
  };
}

/** The sentence names the topic of j's stem: two of its words (all of them, when the stem has fewer). */
function onTopic(sentence, topic) {
  if (!topic || !topic.size) return false;
  let hit = 0;
  sentence.words.forEach((w) => { if (topic.has(w)) hit += 1; });
  return hit >= Math.min(2, topic.size);
}
/** Share of a phrase's words, as written, that a sentence carries. */
function rawShare(sentence, raw) {
  let hit = 0;
  raw.forEach((w) => { if (sentence.raw.has(w)) hit += 1; });
  return raw.size ? hit / raw.size : 0;
}

function states(sentence, t) {
  // an option read with its feedback counts only when the FEEDBACK says something about the later
  // question — the option alone is offered, never asserted
  if (sentence.fb) {
    if (t.kind !== 'words' || ![...sentence.fb].some((w) => t.want.has(w) || t.topic.has(w))) return false;
  }
  if (t.kind === 'number') {
    const has = new Set(sentence.nums);
    const parts = withParts(sentence.nums);
    if (!t.keyNums.every((n) => has.has(n))) return false;
    if ([...sentence.raw].every(isNum)) return false;   // a bare "1/4" option offers a choice, it states nothing
    if (![...t.stemNums].every((n) => parts.has(n))) return false;
    if (t.topic && !onTopic(sentence, t.topic)) return false;
    return !t.wrongNums.some((w) => w.every((n) => has.has(n)));
  }
  if (!carries(sentence.words, t.want)) return false;
  // a wrong option said as fully as the answer: the sentence lists, it does not tell
  // ("crust, then mantle, then outer core"); "Ahmed WAS WRITING" still tells "was writing", not "will write"
  const keyShare = rawShare(sentence, t.keyRaw);
  if (t.wrong.some((w) => carries(sentence.words, w.words) && rawShare(sentence, w.raw) >= keyShare)) return false;
  if (t.want.size <= 2 && !onTopic(sentence, t.topic)) return false;
  return true;
}

const stemKey = (q) => tokens(q && q.question).join(' ');
const keyWords = (q) => { const k = correctList(q)[0]; return content(optionsOf(q)[k]); };
function hasPicture(q) {
  return Boolean(q && ((q.figure && typeof q.figure === 'object' && Object.keys(q.figure).length) || q.picture || q.image_url));
}
const clip = (s, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * @param {object[]} questions the quiz in the order it is played
 * @returns {object[]} one leak per leaking LATER question (the first earlier question found):
 *   { to, from, repeat } for the same stem twice, or { to, from, where, field, text, shown }
 */
function findLeaks(questions) {
  const qs = Array.isArray(questions) ? questions : [];
  const seen = qs.map((q) => (q ? sentencesOf(q) : []));
  const out = [];
  qs.forEach((qj, j) => {
    if (!qj || j === 0) return;
    const sk = stemKey(qj);
    if (sk && !hasPicture(qj)) {
      // and answers that share a word: "Tap the 'air' word." over two different sounds keys "stair" and "chair"
      const kj = keyWords(qj);
      const i = qs.findIndex((qi, k) => k < j && qi && !hasPicture(qi) && stemKey(qi) === sk && [...keyWords(qi)].some((w) => kj.has(w)));
      if (i >= 0) {
        out.push({ to: j, from: i, repeat: true, stem: String(qj.question) });
        return;
      }
    }
    const t = targetOf(qj);
    if (!t) return;
    for (let i = 0; i < j; i += 1) {
      const hit = seen[i].find((x) => states(x, t));
      if (!hit) continue;
      out.push({ to: j, from: i, where: hit.where, field: hit.field, text: hit.text, shown: t.shown });
      return;
    }
  });
  return out;
}

/**
 * @param {object[]} questions the quiz in the order it is played
 * @returns {string[]} one `qJ: ANSWER_LEAK — … qI …` per leaking LATER question (the first earlier question found)
 */
function answerLeakErrors(questions) {
  return findLeaks(questions).map((l) => (l.repeat
    ? `q${l.to}: ANSWER_LEAK — q${l.to} asks word for word what q${l.from} already asks («${clip(l.stem)}»); replace q${l.to} with a question on a different fact of the lesson, one no other question states`
    : `q${l.to}: ANSWER_LEAK — q${l.from} gives away q${l.to}'s answer «${clip(l.shown, 60)}»: q${l.from}'s ${l.where} says «${clip(l.text)}», and the child reads it before q${l.to}; replace q${l.to} with a question on a different fact of the lesson, one no other question, option or explanation states`));
}

/** Read and write one field of a question by its path (["option_feedback", "wrong", "2"]). */
const getAt = (q, field) => field.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), q);
function setAt(q, field, value) {
  const copy = { ...q };
  let o = copy;
  field.slice(0, -1).forEach((k) => { o[k] = { ...o[k] }; o = o[k]; });
  o[field[field.length - 1]] = value;
  return copy;
}

/**
 * THE CHEAPEST REPAIR: take the aside out. Most give-aways are one sentence in
 * an earlier question's explanation, "right" line or wrong-option feedback that
 * is about ANOTHER fact ("…This is a behavioural adaptation." in the feedback on
 * a fox hunting at night, before "Which is a behavioural adaptation of a desert
 * fox?"). That sentence is taken out and both questions are kept — no model call.
 * Never the sentence that explains the earlier question's OWN answer, never a
 * stem or an option, and never when what is left of the field has fewer than
 * three words that carry meaning. Measured on 50 authored quizzes: 30 of 69 leaks
 * were such an aside.
 *
 * @returns {{questions:object[], trimmed:{from:number,to:number,where:string}[]}}
 */
function trimLeakAsides(questions) {
  let current = Array.isArray(questions) ? questions : [];
  const trimmed = [];
  const tried = new Set();
  for (let pass = 0; pass < current.length; pass += 1) {
    const leak = findLeaks(current).find((l) => !l.repeat && l.field && !tried.has(`${l.from}|${l.field.join('.')}|${l.text}`));
    if (!leak) break;
    tried.add(`${leak.from}|${leak.field.join('.')}|${leak.text}`);
    const qi = current[leak.from];
    const own = content(optionsOf(qi)[correctList(qi)[0]]);
    if (own.size && carries(content(leak.text), own)) continue;   // it explains q_i's own answer
    const rest = sentences(getAt(qi, leak.field)).filter((x) => x !== leak.text);
    if ([...content(rest.join(' '))].length < 3) continue;          // nothing left to say
    current = current.map((q, k) => (k === leak.from ? setAt(q, leak.field, rest.join(' ')) : q));
    trimmed.push({ from: leak.from, to: leak.to, where: leak.where });
  }
  return { questions: current, trimmed };
}

const qIndex = (e) => Number(/^q(\d+)/.exec(String(e))[1]);

/**
 * THE LEAKS WORDS CANNOT SEE: one model pass. Measured on a blind counter over
 * 30 quizzes (56 leaked questions) the word check above names a third of them;
 * the rest are given away by ELIMINATION (an earlier question settles which
 * province the ajrak and the kurta belong to, so the later question's other
 * options fall away) or by ONE STEP of reasoning ("the whole group is the
 * bigger number" before "the whole group in 18 − 7"). One call over the
 * numbered quiz finds them; a flag is kept only when the words it quotes name
 * the later question's answer, or name every one of its other options. Kept so,
 * on that counter: precision 0.85, recall 0.84 (the word check: 0.91 / 0.36).
 *
 * Its flags are REWRITTEN only (finalLeakRepair), never a reason to drop a
 * question; a failed or unusable call returns nothing. Never throws.
 *
 * @param {object[]} questions the quiz in the order it is played
 * @param {{complete?:Function, skip?:Set<number>}} [opts] the LLM call (default: transcript-quiz-llm
 *   completeJson); later questions the word check already named
 * @returns {Promise<{errors:string[], flagged:number, kept:number, cost_usd:number, latency_ms:number, error?:string}>}
 */
const LETTERS = 'ABCD';
function leakPrompt(qs) {
  const quiz = qs.map((q, n) => {
    const opts = optionsOf(q);
    const keys = correctList(q);
    const fb = (q.option_feedback && typeof q.option_feedback === 'object') ? q.option_feedback : {};
    const wrong = (fb.wrong && typeof fb.wrong === 'object') ? fb.wrong : {};
    return [
      `Q${n + 1}. ${q.question || ''}`,
      ...opts.map((o, k) => `   ${LETTERS[k] || k}${keys.includes(k) ? ' (correct)' : ''}: ${o}`),
      `   explanation: ${q.explanation || ''}`,
      `   right line: ${typeof fb.correct === 'string' ? fb.correct : ''}`,
      ...Object.entries(wrong).map(([k, t]) => `   feedback if ${LETTERS[Number(k)] || k} chosen: ${t}`),
    ].join('\n');
  }).join('\n\n');
  return `LEAK CHECK. A child plays this quiz in order, Q1 first. After each question the child sees its explanation, its "right line" if they were right, or the feedback for the option they chose.

Find every LATER question Qj whose correct answer a child could get from what an EARLIER question Qi showed them (its question, its correct option, its explanation, its right line, or any of its option feedback) — stated outright, or left as the only possibility (for example Qi says which province the ajrak belongs to, and Qj's other options are then ruled out), or following in one obvious step — without knowing the lesson. Also list Qj when it asks the same thing as an earlier Qi in other words. Do NOT list a Qj just because both are on the same topic, or because a general fact a child already knows answers it.

Return JSON only: {"leaks":[{"later":j,"earlier":i,"quote":"the words of Qi that give it away"}]}. Use [] if none.

QUIZ:
${quiz}`;
}
async function modelLeakErrors(questions, { complete = null, skip = new Set() } = {}) {
  const qs = Array.isArray(questions) ? questions : [];
  const t0 = Date.now();
  const out = { errors: [], flagged: 0, kept: 0, cost_usd: 0, latency_ms: 0 };
  if (qs.length < 2) return out;
  // eslint-disable-next-line global-require
  const call = complete || require('./transcript-quiz-llm').completeJson;
  let json;
  try {
    const res = await call({ prompt: leakPrompt(qs), label: 'transcript_quiz.leak_check', maxTokens: 4000 });
    json = res && res.json;
    out.cost_usd = Number(res && res.costUsd) || 0;
  } catch (err) {
    out.error = String((err && err.message) || err).slice(0, 160);
    out.latency_ms = Date.now() - t0;
    return out;
  }
  const leaks = Array.isArray(json && json.leaks) ? json.leaks : [];
  out.flagged = leaks.length;
  const named = new Set(skip);
  leaks.forEach((l) => {
    const j = Number(l && l.later) - 1;
    const i = Number(l && l.earlier) - 1;
    const quote = String((l && l.quote) || '').trim();
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j <= i || j >= qs.length || !quote || named.has(j)) return;
    const qj = qs[j];
    const keys = correctList(qj);
    const opts = optionsOf(qj);
    const key = opts[keys[0]] || '';
    const said = content(quote);
    const unglossed = (t) => content(String(t).replace(/\s*[(（][^)）]*[)）]\s*/g, ' '));
    const namesKey = [...unglossed(key)].some((w) => said.has(w));
    const others = opts.filter((o, k) => !keys.includes(k) && o.trim()).map(unglossed).filter((w) => w.size);
    const rulesOut = others.length > 0 && others.every((w) => [...w].some((x) => said.has(x)));
    if (!namesKey && !rulesOut) return;
    named.add(j);
    out.errors.push(`q${j}: ANSWER_LEAK — q${i} gives away q${j}'s answer «${clip(key, 60)}»: q${i} says «${clip(quote)}», and the child reads it before q${j}; replace q${j} with a question on a different fact of the lesson, one no other question, option or explanation states`);
  });
  out.kept = out.errors.length;
  out.latency_ms = Date.now() - t0;
  return out;
}

/** Complaint lines renumbered to a set with `dropped` taken out; a dropped question's lines go. */
function renumber(lines, dropped) {
  const gone = new Set(dropped || []);
  return (lines || []).flatMap((e) => {
    const m = /^q(\d+)(:.*)$/s.exec(String(e));
    if (!m) return [e];
    const i = Number(m[1]);
    if (gone.has(i)) return [];
    return [`q${i - [...gone].filter((d) => d < i).length}${m[2]}`];
  });
}

/**
 * THE LAST WORD ON LEAKS, on what is about to ship (generate calls this after
 * every step that can write a question, gates on). Repair, never kill a quiz:
 *   0. an aside in an earlier question that gives the answer away is taken out
 *      (trimLeakAsides) — no model call, both questions kept;
 *   1. ONE targeted rewrite of every leaking LATER question, its complaint
 *      naming the earlier question and the words that give the answer away;
 *      taken when the set stays shippable and leaks less;
 *   2. what still leaks is DROPPED, the latest first, while the quiz keeps
 *      `floor` questions — a question the child is told the answer to measures
 *      nothing, and a quiz one shorter is still a quiz;
 *   3. what is left ships, counted (the faults returned name it).
 * Pure of drawing: the caller draws the set when `changed`.
 *
 * @param {object} p
 * @param {object[]} p.questions the set about to ship, in play order
 * @param {(questions:object[], errors:string[]) => Promise<object>} p.rewrite the targeted rewrite
 *   ({ merged, replaced, costUsd, error })
 * @param {(questions:object[]) => {questions:object[], errors:string[]}} p.check the validator on a candidate
 * @param {(complaint:string) => boolean} p.isSoft a complaint the quiz may ship with
 * @param {number} p.floor the fewest questions a quiz may have
 * @returns {Promise<{record:object|null, changed?:boolean, questions?:object[], dropped?:number[], faults?:string[]}>}
 */
async function finalLeakRepair({ questions, rewrite, check, isSoft, floor, propose = null }) {
  const leaks = answerLeakErrors(questions);
  const t0 = Date.now();
  let model = null;
  if (propose) {
    try { model = await propose(questions, new Set(leaks.map(qIndex))); } catch (err) { model = null; }
  }
  const modelErrs = (model && model.errors) || [];
  const modelStats = model ? {
    flagged: model.flagged || 0, kept: modelErrs.length, rewritten: 0, remaining: modelErrs.length,
    cost_usd: model.cost_usd || 0, latency_ms: model.latency_ms || 0, ...(model.error ? { error: model.error } : {}),
  } : null;
  if (!leaks.length && !modelErrs.length) {
    if (!modelStats) return { record: null };
    return {
      record: { found: 0, trimmed: 0, fixed: 0, dropped: [], remaining: 0, cost_usd: modelStats.cost_usd, latency_ms: Date.now() - t0, model: modelStats },
      changed: false, questions, dropped: [], faults: [],
    };
  }
  const record = {
    found: leaks.length, asked: [...new Set(leaks.map(qIndex))], fixed: 0, dropped: [], remaining: 0,
    cost_usd: modelStats ? modelStats.cost_usd : 0, ...(modelStats ? { model: modelStats } : {}),
  };
  const shippable = (v) => v.errors.every((e) => isSoft(e));
  let current = questions;
  let leaksNow = leaks;
  record.trimmed = 0;
  const trim = trimLeakAsides(current);
  if (trim.trimmed.length) {
    const v = check(trim.questions);
    const left = answerLeakErrors(v.questions);
    if (shippable(v) && left.length < leaks.length) {
      current = v.questions;
      leaksNow = left;
      record.trimmed = trim.trimmed.length;
    }
  }
  // the model's flags on questions the word check does not name: rewritten, never dropped
  const wordAt = new Set(leaksNow.map(qIndex));
  let modelLeft = modelErrs.filter((e) => !wordAt.has(qIndex(e)));
  if (!leaksNow.length && !modelLeft.length) {
    if (modelStats) modelStats.remaining = 0;
    record.latency_ms = Date.now() - t0;
    return { record, changed: current !== questions, questions: current, dropped: [], faults: [] };
  }
  try {
    const rw = await rewrite(current, [...leaksNow, ...modelLeft]);
    record.cost_usd += Number(rw && rw.costUsd) || 0;
    const replaced = (rw && Array.isArray(rw.replaced)) ? rw.replaced : [];
    if (rw && Array.isArray(rw.merged) && replaced.length) {
      const candidate = current.map((q, i) => (replaced.includes(i) && rw.merged[i] ? rw.merged[i] : q));
      const v = check(candidate);
      const left = answerLeakErrors(v.questions);
      // a flagged question counts as rewritten only when its words changed — a rewrite that hands it back is no
      // repair. Both sides as the validator writes them: the stored set was normalised by it too.
      const before = check(current).questions;
      const words = (q) => (q ? `${tokens(q.question).join(' ')}|${optionsOf(q).map((o) => tokens(o).join(' ')).sort().join('|')}` : '');
      const modelFixed = modelLeft.filter((e) => replaced.includes(qIndex(e)) && v.questions[qIndex(e)]
        && words(v.questions[qIndex(e)]) !== words(before[qIndex(e)]));
      if (shippable(v) && left.length <= leaksNow.length && (left.length < leaksNow.length || modelFixed.length)) {
        current = v.questions;
        record.fixed = leaksNow.length - left.length;
        if (modelStats) modelStats.rewritten = modelFixed.length;
        modelLeft = modelLeft.filter((e) => !modelFixed.includes(e));
      } else record.rewrite = shippable(v) ? 'nothing_fixed' : 'merged_set_invalid';
    } else record.rewrite = (rw && rw.error) ? 'rewrite_failed' : 'nothing_usable';
  } catch (err) {
    record.rewrite = 'error';
  }
  let left = answerLeakErrors(current);
  const room = Math.max(0, current.length - floor);
  const drop = [...new Set(left.map(qIndex))].sort((a, b) => b - a).slice(0, room).sort((a, b) => a - b);
  if (drop.length) {
    const v = check(current.filter((_, i) => !drop.includes(i)));
    if (shippable(v)) {
      current = v.questions;
      record.dropped = drop;
      left = answerLeakErrors(current);
    } else record.drop = 'what_survived_did_not_validate';
  }
  // what the model flagged and no rewrite replaced ships, counted — renumbered past any drop
  const modelShipped = renumber(modelLeft, record.dropped);
  if (modelStats) modelStats.remaining = modelShipped.length;
  record.remaining = left.length;
  record.latency_ms = Date.now() - t0;
  return {
    record, changed: current !== questions, questions: current, dropped: record.dropped, faults: [...left, ...modelShipped],
  };
}

/**
 * The recorded soft faults once leaks are settled: the old ANSWER_LEAK lines go,
 * every other line about a dropped question goes, the rest are renumbered to the
 * set that ships, and the leaks still in it are added.
 */
function settleLeakFaults(faults, dropped, leaks) {
  const gone = new Set(dropped || []);
  const kept = (Array.isArray(faults) ? faults : []).flatMap((e) => {
    const s = String(e);
    if (/^q\d+: ANSWER_LEAK\b/.test(s)) return [];
    const m = /^q(\d+)(:.*)$/s.exec(s);
    if (!m) return [s];
    const i = Number(m[1]);
    if (gone.has(i)) return [];
    return [`q${i - [...gone].filter((d) => d < i).length}${m[2]}`];
  });
  return [...kept, ...(leaks || [])];
}

module.exports = {
  answerLeakErrors, findLeaks, trimLeakAsides, modelLeakErrors, finalLeakRepair, settleLeakFaults,
};
