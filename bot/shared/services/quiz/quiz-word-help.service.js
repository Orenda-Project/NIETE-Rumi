'use strict';
/**
 * Word help on an English lesson quiz's rows (bd-0q8b4x): the I/O half of
 * quiz-word-help.js. Runs once, on the final rows, just before they are stored.
 *
 *   1. the book's own words (the lesson's glossary) found in each question;
 *   2. ONE call offers up to two more hard words per question with a short
 *      Urdu meaning (shape-checked by cleanMade);
 *   3. ONE key-checker call (lp-quiz-key-check-words) judges every meaning;
 *      only those it calls right are kept, at most 3 per question, stored on
 *      the row as media.word_help. The page shows them only while the switch is
 *      on (web-quiz.service, servedWords).
 *
 * Never fails a quiz. A propose failure keeps the book words for the check; a
 * check failure keeps ONLY the book's own words (the lesson's own meaning),
 * never a made one. Off (app_settings quiz_word_help) or not English: no call.
 */
const W = require('./quiz-word-help');
const Check = require('./lp-quiz-key-check-words');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const PROPOSE_LABEL = 'quiz.word_help.propose';
const arr = (v) => (Array.isArray(v) ? v : []);

function proposePrompt(rows, book) {
  const items = rows.map((r, i) => `q${i}: ${W.rowText(r).replace(/\s*\n\s*/g, ' | ')}${
    book[i].length ? `\n  already helped: ${book[i].map((w) => w.en).join(', ')}` : ''}`).join('\n');
  return `A children's English quiz (primary school, Pakistan). Children read Urdu far better than English. For each question pick at most 2 English words a young Urdu-speaking child is least likely to know (not names, not words already helped, never a word whose meaning gives away the answer) and give each a short simple Urdu meaning in Urdu script, 1 to 3 words.

${items}

Return ONLY this JSON: { "items": [ { "index": 0, "words": [ { "en": "word", "ur": "معنی" } ] } ] }`;
}

const key = (i, en) => `${i}|${en}`;

/**
 * @param {object[]} rows the final quiz_questions rows, index-aligned with the quiz
 * @param {{language:string, slideScript?:object, quizId?:string}} ctx
 * @param {{flag?:Function, complete?:Function}} deps injectable for tests
 * @returns {Promise<{rows:object[], record:object|null}>}
 */
async function maybeAttach(rows, ctx = {}, deps = {}) {
  const flag = deps.flag || require('./quiz-word-help-flag').readFlag;
  if (ctx.language !== 'en' || !arr(rows).length) return { rows, record: null };
  if (!(await flag()).on) return { rows, record: null };
  const complete = deps.complete || require('./transcript-quiz-llm').completeJson;
  const record = { status: 'checked', book: 0, made: 0, kept: 0, rejected: 0, cost_usd: 0 };

  const glossary = W.bookGlossary(ctx.slideScript);
  const book = rows.map((r) => W.matchWords(r, glossary));
  record.book = book.reduce((n, b) => n + b.length, 0);

  const made = rows.map(() => []);
  try {
    const p = await complete({ prompt: proposePrompt(rows, book), maxTokens: 2000, label: PROPOSE_LABEL });
    record.cost_usd += Number(p.costUsd) || 0;
    arr(p.json && p.json.items).forEach((it) => {
      const i = Number(it && it.index);
      if (!Number.isInteger(i) || !rows[i]) return;
      arr(it.words).slice(0, 2).forEach((w) => {
        const c = W.cleanMade(rows[i], w);
        if (c && !book[i].some((b) => b.en === c.en) && !made[i].some((m) => m.en === c.en)) made[i].push(c);
      });
    });
  } catch (err) {
    record.propose_error = String(err.message || err).slice(0, 200);
  }
  record.made = made.reduce((n, m) => n + m.length, 0);

  const all = rows.map((_, i) => [...book[i], ...made[i]]);
  let approved = null;
  const toCheck = all.flatMap((ws, i) => ws.map((w) => ({ index: i, en: w.en, ur: w.ur })));
  if (toCheck.length) {
    try {
      const prompt = Check.buildWordCheckPrompt({ rows, words: toCheck, slideScript: ctx.slideScript, rowText: W.rowText });
      const c = await complete({ prompt, maxTokens: 4000, label: Check.LABEL });
      record.cost_usd += Number(c.costUsd) || 0;
      approved = Check.parseWordVerdicts(c.json);
    } catch (err) {
      record.status = 'check_error';
      record.check_error = String(err.message || err).slice(0, 200);
      logToFile('⚠️ quiz word help: the key check failed — only the book\'s own words kept', { quizId: ctx.quizId, error: record.check_error });
    }
  }

  const out = rows.map((r, i) => {
    const keep = approved ? all[i].filter((w) => approved.has(key(i, w.en))) : book[i];
    record.kept += keep.length;
    if (!keep.length) return r;
    return { ...r, media: { ...(r.media || {}), word_help: keep.slice(0, W.PER_QUESTION) } };
  });
  record.rejected = approved ? toCheck.length - record.kept : 0;
  record.cost_usd = Math.round(record.cost_usd * 1e6) / 1e6;
  logEvent('quiz.word_help', { quizId: ctx.quizId, ...record });
  return { rows: out, record };
}

module.exports = { maybeAttach, proposePrompt, PROPOSE_LABEL };
