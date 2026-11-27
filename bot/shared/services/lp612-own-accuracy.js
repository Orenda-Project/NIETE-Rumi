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
// bd-snkn32.58.17 — a re-check came back cut off at 2,000 tokens (q367 subtract run: null → refused).
const GOAL_CHECK_TOKENS = 4000;

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

/**
 * bd-snkn32.58.3 (queue #155 C) — the check BEFORE a goal plan is shown: the same job, one call, facts AND goal match.
 * Each section must serve her goal (a section about something else is named); a wrong fact is listed. Pure but the call.
 */
function goalCheckMessages({ plan, goal, grade }) {
  const system = 'You check one classroom lesson plan for a government school in Pakistan, for two things only. '
    + `1) FACTUAL accuracy for ${grade ? `Grade ${grade}` : 'its grade'}: the class has no textbook, so every fact, `
    + 'definition, example answer, number, spelling and worked answer reaches the children as written; list each one that '
    + 'is wrong (a simplification that is still true is fine). An error is only a statement that is false: a wrong fact, '
    + 'answer, sum, count, spelling, word, sound or meaning. Something not taught earlier in the plan, a definition that '
    + 'could say more, a word with other uses, or a step that could confuse is not an error. 2) Whether each section serves the goal: '
    + 'name a section only when its main activity teaches a different skill or topic than the teacher\'s goal. Do not judge '
    + 'method, length, style, language, or labels and titles. Never list a statement you find correct, acceptable or fine. '
    + 'A tip (a repeated example, an easier or harder item, a clearer step, something that could confuse) is not an error '
    + 'and not off the goal: put it in "notes". Answer JSON only: {"accurate": true|false, "errors": ["<the wrong statement> -> <why>"], '
    + '"on_goal": true|false, "off_goal": ["<section>: <the other skill or topic it teaches>"], "notes": ["<tip>"]}.';
  const user = `The teacher's goal: "${String((goal && goal.text) || '').slice(0, 200)}"\n\nTHE PLAN:\n${String(plan || '').slice(0, PLAN_MAX)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const lines = (v) => (Array.isArray(v) ? v : []).filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim().slice(0, 300));

// bd-snkn32.58.9 — live re-runs: the checker listed lines it dismissed itself ("acceptable rounding, not an error",
// "which is stated, so this is fine"), and any listed line refused the plan. A line that says so is not an error.
// bd-snkn32.58.17 — and "-> this is correct, but could confuse" (q367 phonics re-run).
const DISMISSED = /\bnot an? (?:factual )?error\b|\bno error\b|\bso this is fine\b|\bthis is fine\b|\bacceptable rounding\b|->\s*this is correct\b|\bnot factually wrong\b|\bnot listing (?:it |this )?as an? (?:factual )?error\b/i;

/** { accurate, errors, onGoal, offGoal } from the reply, or null when it cannot be read. */
function parseGoalCheck(content) {
  let obj;
  try {
    const text = String(content || '');
    obj = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj.accurate !== 'boolean' || typeof obj.on_goal !== 'boolean') return null;
  const listed = lines(obj.errors);
  const errors = listed.filter((e) => !DISMISSED.test(e));
  const offGoal = lines(obj.off_goal);
  const allDismissed = listed.length > 0 && !errors.length;
  return { accurate: (obj.accurate || allDismissed) && !errors.length, errors, onGoal: obj.on_goal && !offGoal.length, offGoal };
}

/** One model call; never throws: a failure is null (the caller asks once more, then refuses). */
async function checkGoalPlan(client, model, { plan, goal, grade }) {
  try {
    const res = await client.chat.completions.create({
      model, job: ACCURACY_JOB, temperature: 0, messages: goalCheckMessages({ plan, goal, grade }),
      max_completion_tokens: GOAL_CHECK_TOKENS, response_format: { type: 'json_object' }, reasoning: { enabled: false },
    });
    return parseGoalCheck(res && res.choices && res.choices[0] && res.choices[0].message.content);
  } catch (_) {
    return null;
  }
}

module.exports = { accuracyMessages, parseAccuracy, checkAccuracy, goalCheckMessages, parseGoalCheck, checkGoalPlan, ACCURACY_JOB };
