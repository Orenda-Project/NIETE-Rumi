'use strict';
/**
 * bd-snkn32.4 — the model call that rewrites a grades 1–5 day for her class (job lp.k5own). The request and the gate
 * are pure (lp-k5-own.js); this sends it, and on a refusal sends the gate's reasons back for ONE repair round. A plan
 * the gate still refuses is null: her row fails ("Couldn't make it"), never a PDF of a plan that broke the rules.
 *
 * bd-snkn32.40 — after each reply the SOFT rules are fixed in code first (lp-own-fit.fitK5: minutes to the period,
 * extra activities trimmed to her class size, a long plan kept with a warning); only the HARD rules refuse. A teacher
 * checking each child in a big class goes back once (repairOnly) but is never the final refusal on its own: round 2
 * is accepted with a warning, or, if round 2 breaks a hard rule, round 1's plan is kept with the warning.
 */
const { k5Messages, parseK5Reply, checkK5Rewrite } = require('./lp-k5-own');
const { periodOf } = require('./lp-own-period');
const { fitK5, repairOnly } = require('./lp-own-fit');

const JOB = 'lp.k5own';
const ROUNDS = 2;

async function rewriteK5({ script, answers, edit, lang, grade, subject, dayPages = null, bookText = null, client, model, log = () => {} }) {
  const llm = client || require('./llm-client').getClient();
  const useModel = model || require('../config/model-registry').modelFor(JOB);
  // bd-snkn32.15: a change ("Change this plan") sends her one change instead of the class answers; same gate.
  const messages = edit
    ? require('./lp-own-edit-instruction').k5EditMessages({ script, edit, lang, grade, subject })
    : k5Messages({ script, answers, lang, grade, subject, dayPages, bookText });
  // bd-snkn32.30 — a make is held to her class size and the day's own period; a change keeps the old gate.
  const make = !edit && answers;
  const opts = make ? { lang, resources: answers.resources, size: answers.size, period: periodOf(script) } : { lang };
  let kept = null; // round 1's plan when its only fault was a repair-only one
  for (let round = 1; round <= ROUNDS; round++) {
    const res = await llm.chat.completions.create({
      model: useModel, job: JOB, temperature: 0.3, messages: [...messages],
      max_completion_tokens: 16000, response_format: { type: 'json_object' }, reasoning: { enabled: false },
    });
    const content = (res && res.choices && res.choices[0] && res.choices[0].message.content) || '';
    const next = parseK5Reply(content);
    let reasons = ['the reply was not a JSON plan'];
    if (next) {
      const fit = fitK5(script, next, opts);
      const hard = checkK5Rewrite(script, fit.script, opts);
      const repair = make ? repairOnly(fit.script, answers.size) : [];
      const done = { script: fit.script, model: useModel, rounds: round, fixes: fit.fixes, warnings: fit.warnings };
      if (!hard.length && (!repair.length || round === ROUNDS)) {
        done.warnings = [...done.warnings, ...repair];
        if (done.fixes.length || done.warnings.length) log('LP K-5 own: soft fixes', { round, fixes: done.fixes, warnings: done.warnings });
        return done;
      }
      if (!hard.length) kept = { ...done, warnings: [...done.warnings, ...repair] };
      reasons = [...hard, ...repair];
    }
    log('LP K-5 own: rewrite refused', { round, reasons });
    messages.push({ role: 'assistant', content }, { role: 'user', content: `Refused: ${reasons.join('; ')}. Send the whole plan again, fixed.` });
  }
  if (!kept) return null;
  log('LP K-5 own: soft fixes', { round: kept.rounds, fixes: kept.fixes, warnings: kept.warnings, keptRound1: true });
  return { ...kept, rounds: ROUNDS };
}

module.exports = { rewriteK5, JOB, ROUNDS };
