// bd-snkn32.4 — a real grades 1–5 "Make my own" end to end, outside the queue: the day's stored plan (sandbox DB) →
// the live rewrite (lp.k5own) → the printed phone PDF, exactly the worker's three steps. Writes <lesson>.pdf/.json
// beside this file. Usage (from the repo root, env from keys/niete-local.env): node docs/lp612/make-my-own-g1-5/make-samples.js <lessonId> <answersJSON>
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');
const { loadK5 } = require(path.join(root, 'bot/shared/services/lp-k5-own-source'));
const { rewriteK5 } = require(path.join(root, 'bot/shared/services/lp-k5-own-author'));
const { renderK5Own, WAY_NAMES } = require(path.join(root, 'bot/shared/services/lp-k5-own-render'));
const { printCard } = require(path.join(root, 'bot/shared/services/lp-v10-card/print'));
const { parseOwnAnswers } = require(path.join(root, 'bot/shared/services/lp612-own-instruction'));
(async () => {
  const [lessonId, raw] = process.argv.slice(2);
  const parsed = parseOwnAnswers(JSON.parse(raw));
  if (!parsed.ok) throw new Error(parsed.error);
  const day = await loadK5(lessonId);
  if (!day) throw new Error('no stored plan for ' + lessonId);
  const t0 = Date.now();
  const out = await rewriteK5({ script: day.script, answers: parsed.answers, lang: day.lang, grade: day.grade, subject: day.subject, log: console.log });
  console.log(JSON.stringify({ lessonId, lang: day.lang, ms: Date.now() - t0, ok: !!out, rounds: out && out.rounds, model: out && out.model }));
  if (!out) process.exit(1);
  const html = renderK5Own(out.script, { lang: day.lang, grade: day.grade, subject: day.subjectName, way: WAY_NAMES[day.lang][parsed.answers.way] });
  fs.writeFileSync(path.join(__dirname, `${lessonId}.html`), html);
  fs.writeFileSync(path.join(__dirname, `${lessonId}.json`), JSON.stringify({ before: day.script, after: out.script }, null, 1));
  await printCard(html, path.join(__dirname, `${lessonId}.pdf`));
})().catch((e) => { console.error(e); process.exit(1); });
