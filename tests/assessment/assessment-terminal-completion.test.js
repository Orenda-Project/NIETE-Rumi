/**
 * A terminal screen ENDS the Flow. Its Footer `complete`s; the endpoint never
 * runs for it. So any work that screen promises — "Make my paper", "Rebuild
 * paper" — has to be performed by the COMPLETION handler, keyed off the action
 * the screen rides out with.
 *
 * This bit three times in three days, each fixed alone:
 *   CONFIRM   → submit never ran        (bd-60030, 4 Sep)
 *   KEEP      → behind a terminal CONFIRM, unreachable (bd-60043, 6 Sep)
 *   PICK_DONE → rebuild never ran       (bd-60044, 6 Sep)
 * Each time the teacher read a cheerful acknowledgement for a step that never
 * started. This test makes the rule structural: every action a terminal screen
 * emits must have a branch in the completion handler that DOES the work, not
 * just one that names a message for it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ENDPOINT = read('bot/shared/routes/assessment-gen-endpoint.js');
const HANDLER = read('bot/shared/handlers/flow-response.handler.js');
const FLOWS = ['assessment-gen-flow.json', 'assessment-review-flow.json']
  .map((f) => JSON.parse(read(`docs/flows/${f}`)));

// Every action the endpoint sends out with a terminal screen's completion payload.
const emitted = [...ENDPOINT.matchAll(/completionPayload\('([a-z_]+)'/g)].map((m) => m[1]);

// The completion handler, from its declaration to the MESSAGES table: the part
// that WORKS. A branch that only appears inside MESSAGES names a string, not an act.
const handlerStart = HANDLER.indexOf('async function handleAssessmentFlowCompletion');
const workSection = HANDLER.slice(handlerStart, HANDLER.indexOf('const MESSAGES', handlerStart));

describe('every terminal screen has a completion branch that does its work', () => {
  test('the endpoint emits at least one terminal action (else this suite is vacuous)', () => {
    expect(emitted.length).toBeGreaterThan(0);
  });

  test.each(emitted)("action '%s' has a working branch in the completion handler", (action) => {
    expect(workSection).toMatch(new RegExp(`if \\(action === '${action}'\\)`));
    // ...and that branch reaches an endpoint function, not just a message.
    const branch = workSection.slice(workSection.indexOf(`if (action === '${action}')`));
    expect(branch).toMatch(/require\('\.\.\/routes\/assessment-gen-endpoint'\)/);
  });

  test('every terminal screen in the Flows completes rather than data_exchanges', () => {
    const bad = [];
    for (const flow of FLOWS) {
      for (const s of flow.screens.filter((x) => x.terminal)) {
        const footers = JSON.stringify(s).match(/"type":\s*"Footer"[^}]*?"on-click-action":\s*\{"name":\s*"([a-z_]+)"/g) || [];
        for (const f of footers) {
          const name = f.match(/"name":\s*"([a-z_]+)"/)[1];
          if (name !== 'complete') bad.push(`${s.id}: Footer ${name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('a terminal screen routes nowhere — its work cannot be "on the next screen"', () => {
    const bad = [];
    for (const flow of FLOWS) {
      for (const s of flow.screens.filter((x) => x.terminal)) {
        if ((flow.routing_model[s.id] || []).length) bad.push(s.id);
      }
    }
    expect(bad).toEqual([]);
  });
});
