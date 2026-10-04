'use strict';
/**
 * v3 untimed EGMA: `ma.discrimination`, `ma.missing`, `ma.add2`, `ma.sub2`, `ma.word_problems` — Gemini 3.8
 * Flash on the whole note with the items and answers (R8's idnummag/comp/wp arm), the 4-consecutive-errors
 * stop on its verdicts (EGMA Toolkit p.11), and every item the model could not settle ("no audible answer":
 * children point, or answer too quietly) to the coach (R8 §4). The child must SAY the answer: pointing is
 * never scored correct (EGMA Toolkit p.36).
 */
const P = require('./prompts');
const { untimedTask } = require('./engine');

const OP_OF = { add2: '+', sub2: '-' };

function questionOf(kind, it, lang) {
  if (kind === 'discrimination') return { text: `Which is bigger: ${it.a} or ${it.b}?`, answer: it.answer != null ? it.answer : Math.max(it.a, it.b) };
  if (kind === 'missing') return { text: (it.seq || []).map((x) => (x == null ? '__' : x)).join(', '), answer: it.answer };
  if (kind === 'word_problems') return { text: String(lang === 'en' ? (it.prompt_en || it.prompt_ur) : (it.prompt_ur || it.prompt_en)).replace(/\s+/g, ' ').trim(), answer: it.answer };
  return { text: P.sumText({ ...it, op: it.op || OP_OF[kind] }), answer: it.answer };
}

function refOf(kind, it, q) {
  if (it.id) return it.id;
  if (kind === 'discrimination') return `${it.a} | ${it.b}`;
  return q.text;
}

async function score(ctx) {
  const { spec, grade, kind } = ctx;
  const qs = spec.items.map((it) => questionOf(kind, it, ctx.coachLang));
  const m = await untimedTask(ctx, {
    refs: spec.items.map((it, k) => refOf(kind, it, qs[k])),
    prompt: P.ORAL_ITEMS({ grade, kind, questions: qs }),
    schema: P.ORAL_SCHEMA,
  });
  return m;
}

module.exports = { score, questionOf };
