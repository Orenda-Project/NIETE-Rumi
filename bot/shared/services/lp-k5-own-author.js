'use strict';
/**
 * bd-snkn32.4 — the model call that rewrites a grades 1–5 day for her class (job lp.k5own). The request and the gate
 * are pure (lp-k5-own.js); this sends it, and on a refusal sends the gate's reasons back for ONE repair round. A plan
 * the gate still refuses is null: her row fails ("Couldn't make it"), never a PDF of a plan that broke the rules.
 */
const { k5Messages, parseK5Reply, checkK5Rewrite } = require('./lp-k5-own');

const JOB = 'lp.k5own';
const ROUNDS = 2;

async function rewriteK5({ script, answers, lang, grade, subject, client, model, log = () => {} }) {
  const llm = client || require('./llm-client').getClient();
  const useModel = model || require('../config/model-registry').modelFor(JOB);
  const messages = k5Messages({ script, answers, lang, grade, subject });
  for (let round = 1; round <= ROUNDS; round++) {
    const res = await llm.chat.completions.create({
      model: useModel, job: JOB, temperature: 0.3, messages: [...messages],
      max_completion_tokens: 16000, response_format: { type: 'json_object' }, reasoning: { enabled: false },
    });
    const content = (res && res.choices && res.choices[0] && res.choices[0].message.content) || '';
    const next = parseK5Reply(content);
    const reasons = next ? checkK5Rewrite(script, next, { lang }) : ['the reply was not a JSON plan'];
    if (!reasons.length) return { script: next, model: useModel, rounds: round };
    log('LP K-5 own: rewrite refused', { round, reasons });
    messages.push({ role: 'assistant', content }, { role: 'user', content: `Refused: ${reasons.join('; ')}. Send the whole plan again, fixed.` });
  }
  return null;
}

module.exports = { rewriteK5, JOB, ROUNDS };
