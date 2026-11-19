'use strict';
/**
 * bd-snkn32.56 (queue #134 E) — the content-accuracy check for a book-less own plan (a goal start).
 *
 * WHY. A plan made from a goal or topic is taught with no book in the room: the children copy what the plan says, so a
 * wrong fact has no page beside it to catch it. The rubric reviewer (lp612-own-review) judges teaching, not facts; this
 * one model call lists factual errors only. Its answer is the reviewer's `ACC` item: accurate = 4, an error = 1, an
 * unreadable answer = null. Anything but accurate keeps the plan off the shared shelf; she always keeps her plan.
 *
 * The model call is here (job lp.ownAccuracy, model-registry) so its site is one file; the rest is pure.
 */

const ACCURACY_JOB = 'lp.ownAccuracy';
const PLAN_MAX = 60000;

function accuracyMessages({ plan, goal, grade }) {
  const system = 'You check one classroom lesson plan for FACTUAL accuracy only, for a government school in Pakistan. '
    + 'The class has no textbook, so every fact, definition, example answer, number, date, spelling and worked answer '
    + 'in the plan reaches the children as written. List each statement that is wrong or misleading for '
    + `${grade ? `Grade ${grade}` : 'its grade'} (a simplification that is still true is fine). Do not judge teaching `
    + 'method, length, style or language. Answer JSON only: {"accurate": true|false, "errors": ["<the wrong statement> -> <why>"]}.';
  const user = `The teacher's goal: "${String((goal && goal.text) || '').slice(0, 200)}"\n\nTHE PLAN:\n${String(plan || '').slice(0, PLAN_MAX)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** { accurate, errors } from the reply, or null when it cannot be read. Errors listed = not accurate. */
function parseAccuracy(content) {
  let obj;
  try {
    const text = String(content || '');
    obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj.accurate !== 'boolean') return null;
  const errors = (Array.isArray(obj.errors) ? obj.errors : []).filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim().slice(0, 300));
  return { accurate: obj.accurate && errors.length === 0, errors };
}

/** One model call; never throws: a failure is null (not accurate as far as the shelf is concerned). */
async function checkAccuracy(client, model, { plan, goal, grade }) {
  try {
    const res = await client.chat.completions.create({
      model, job: ACCURACY_JOB, temperature: 0, messages: accuracyMessages({ plan, goal, grade }),
      max_completion_tokens: 2000, response_format: { type: 'json_object' }, reasoning: { enabled: false },
    });
    return parseAccuracy(res && res.choices && res.choices[0] && res.choices[0].message.content);
  } catch (_) {
    return null;
  }
}

module.exports = { accuracyMessages, parseAccuracy, checkAccuracy, ACCURACY_JOB };
