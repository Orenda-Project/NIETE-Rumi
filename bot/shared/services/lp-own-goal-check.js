'use strict';
/**
 * bd-snkn32.58.3 (queue #155 C) — a goal plan stays on its goal and is checked BEFORE she sees it (Amena 19 Nov: "how do
 * we ensure it remains on task without a textbook?"). Book plans are unchanged.
 *
 *   goal box     added by code after the rewrite, so it is always there and always the official words:
 *                grades 1–5 — the script's `goal` (printed at the top; "Before they write" reads it, lp-k5-own-close);
 *                grades 6–12 — "Today's goal: …" as the LAST objective, so no `ur_overlay` pointer moves
 *   check        lp612-own-accuracy.checkGoalPlan (facts + goal match per section), injected as `check(doc)`
 *   fix/refuse   a failed check → ONE fix rewrite fed the findings → re-check; still failing, or the fix failed →
 *                'refused' (the worker ends her row OWN_GOAL_UNSURE); an unreadable check is asked once more, then refused
 *
 * Pure orchestration: the check and the fix are passed in.
 */

const passed = (r) => !!r && r.accurate && r.onGoal;

/** The instruction for the one fix rewrite: the findings, her goal, and keep the plan whole. */
function fixInstruction(r, goal) {
  const found = [...((r && r.errors) || []).map((e) => `- Wrong: ${e}`), ...((r && r.offGoal) || []).map((e) => `- Off the goal: ${e}`)];
  return [
    `FIX THIS PLAN. A checker found problems in a plan for the goal "${String((goal && goal.text) || '').replace(/["“”]/g, '')}":`,
    ...found,
    'Correct every wrong statement and make every listed section work towards the goal. Keep every section and the same '
      + 'layout; change only what is needed. End each section with one short line on how it serves the goal.',
  ].join('\n');
}

/** { verdict: pass|fixed|refused, doc, findings } — `doc` is what she gets when not refused. */
async function checkBeforeReady({ check, fix, doc }) {
  let first = await check(doc);
  if (first == null) first = await check(doc); // unreadable: ask once more
  if (first == null) return { verdict: 'refused', doc, findings: 0 };
  if (passed(first)) return { verdict: 'pass', doc, findings: 0 };
  const findings = first.errors.length + first.offGoal.length;
  const fixed = await fix(first);
  if (!fixed || fixed.doc == null) return { verdict: 'refused', doc, findings };
  const again = await check(fixed.doc);
  return passed(again) ? { verdict: 'fixed', doc: fixed.doc, findings } : { verdict: 'refused', doc, findings };
}

/** Grades 1–5: the script's goal is the exact official goal. A new script; the one given is never changed. */
function goalBoxK5(script, goal) {
  if (!script || typeof script !== 'object' || !goal || !goal.text) return script;
  return { ...script, goal: String(goal.text).trim() };
}

const GOAL_LEAD = "Today's goal: ";

/** Grades 6–12: "Today's goal: …" once, as the last objective. A new document. */
function goalBox612(doc, goal) {
  if (!doc || !doc.objectives || !Array.isArray(doc.objectives.items) || !goal || !goal.text) return doc;
  const out = JSON.parse(JSON.stringify(doc));
  const text = `${GOAL_LEAD}${String(goal.text).trim()}`;
  if (!out.objectives.items.some((o) => o && typeof o.text === 'string' && o.text.startsWith(GOAL_LEAD))) out.objectives.items.push({ text });
  return out;
}

/**
 * The worker's one call: box the plan, check it (fix once), log `own_plan.check` (ids and counts only), and return the
 * plan she gets — or throw OWN_GOAL_UNSURE so her row ends failed with the refusal screen. `rewrite(doc, instruction)`
 * is the band's own rewrite, returning the new plan or null.
 */
async function goalGate(d, { row, band, doc, grade, rewrite, correlationId }) {
  const goal = row.answers.goal;
  const box = band === 'k5' ? goalBoxK5 : goalBox612;
  const boxed = box(doc, goal);
  const r = await checkBeforeReady({
    doc: boxed,
    check: (x) => d.goalCheck({ plan: JSON.stringify(x), goal, grade }),
    fix: async (found) => { const next = await rewrite(boxed, fixInstruction(found, goal)); return next ? { doc: box(next, goal) } : null; },
  });
  d.log('own_plan.check', { ownId: row.id, band, result: r.verdict, findings: r.findings, correlationId });
  if (r.verdict === 'refused') throw Object.assign(new Error('the plan did not pass the goal check'), { code: 'OWN_GOAL_UNSURE' });
  return r.doc;
}

module.exports = { checkBeforeReady, fixInstruction, goalBoxK5, goalBox612, goalGate, passed, GOAL_LEAD };
