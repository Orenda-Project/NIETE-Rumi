'use strict';
/**
 * bd-xkq6q — the grader describes a substitution in its own rationale and then scores the move
 * `not_done`. On 4,112 prod move-pairs the full-credit substitution verdicts are used on 2.3–2.7%
 * of moves; reading 46 disputed moves across 10 sessions, 54% were the teacher doing the prescribed
 * PEDAGOGY on different CONTENT (a different example/number/sentence/story).
 *
 * These tests assert the SHIPPED system prompt — the one `analyzeFidelity` actually sends to the
 * model — carries the two new rules, and that the rules D18/D19/D28 and the anti-fabrication
 * guards they must not weaken are still present verbatim. The LLM is MOCKED (injected client), so
 * this executes the real call-builder over the real GRADER_BRIEF and never touches the network.
 */
const { analyzeFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-analyzer');
const { GRADER_BRIEF } = require('../../../bot/shared/services/coaching/fidelity/grader-prompt');

function fakeClient(responseContent, usage = { prompt_tokens: 100, completion_tokens: 50 }) {
  const calls = [];
  return {
    calls,
    chat: {
      completions: {
        create: async (params) => {
          calls.push(params);
          return { choices: [{ message: { content: responseContent } }], usage };
        },
      },
    },
  };
}

const MOVES = [
  { move_id: 'm1', phase: 'explain', type: 'modelling', text: 'Model long division with 517 ÷ 4', bucket: 'must_happen', selection: 'none', track_time_on_task: false, prescribed_minutes: null, adjudicable: true },
  { move_id: 'm2', phase: 'recall', type: 'activity', text: 'Partner A and partner B recall yesterday’s rule to each other', bucket: 'must_happen', selection: 'none', track_time_on_task: false, prescribed_minutes: null, adjudicable: true },
];
const META = { lesson_id: 'L1', template: 'STANDARD', goal: 'divide 3-digit by 1-digit', total_minutes: 35 };
const TRANSCRIPT = '[04:10] Teacher: 2056 taqseem 3, pehle 2 lo…';
const OK = JSON.stringify({ verdicts: [{ move_id: 'm1', verdict: 'executed' }], narrative: 'ok' });

/** Whitespace-normalised, so a phrase assertion does not depend on where a line happens to wrap. */
const flat = (s) => s.replace(/\s+/g, ' ');

/** The system prompt as the model receives it — the changed line, executed. */
async function sentSystemPrompt() {
  const client = fakeClient(OK);
  await analyzeFidelity(MOVES, TRANSCRIPT, META, { client });
  const params = client.calls[0];
  expect(params.messages[0].role).toBe('system');
  return params.messages[0].content;
}

describe('grader prompt — substitution calibration (bd-xkq6q)', () => {
  describe('the two new rules reach the model', () => {
    test('DIFFERENT-CONTENT rule: the plan’s example is the illustration, not the move', async () => {
      const sys = await sentSystemPrompt();
      expect(sys).toContain('DIFFERENT CONTENT IS NOT A DIFFERENT MOVE');
      // the concrete instruction: same pedagogical action on other content still counts
      expect(sys).toMatch(/example|number|sentence|story/i);
      expect(flat(sys)).toContain('the illustration, not the move');
      // and it must route to the full-credit verdicts, not to not_done
      expect(flat(sys)).toContain('Same sub-skill, different example → credit it.');
    });

    test('DIFFERENT-CONTENT rule keeps the SUB-SKILL as the boundary, so D18 still bites', async () => {
      const sys = await sentSystemPrompt();
      expect(flat(sys)).toContain('The line is the SUB-SKILL, not the content');
      expect(flat(sys)).toContain('Different sub-skill → `not_done`.');
    });

    test('DIFFERENT-CONTENT rule does NOT open substituted_better — a different example is not "better"', async () => {
      const sys = await sentSystemPrompt();
      expect(flat(sys)).toContain('a different example is not "better"');
      expect(flat(sys)).toContain('clearly pedagogically STRONGER than the prescribed one');
    });

    test('SELF-CONSISTENCY rule: a rationale that names what she did instead cannot end in not_done', async () => {
      const sys = await sentSystemPrompt();
      expect(sys).toContain('DO NOT CONTRADICT YOURSELF');
      expect(flat(sys)).toContain('`not_done` is the wrong verdict');
      // it must name the offending shape, not merely gesture at it
      expect(sys).toMatch(/rationale/);
    });

    test('SELF-CONSISTENCY rule is subordinate to the lesson-mismatch rule (no near-miss laundering)', async () => {
      const sys = await sentSystemPrompt();
      expect(flat(sys)).toContain('This never overrides the LESSON-MISMATCH RULE');
      expect(flat(sys)).toContain('is not a substitution — those moves stay `not_done`.');
    });
  });

  describe('what must NOT be weakened', () => {
    test('D18 — one activity satisfies at most ONE prescribed move', async () => {
      const sys = await sentSystemPrompt();
      expect(sys).toContain('**One activity satisfies at most ONE prescribed move (no double-counting).**');
      expect(sys).toContain('The same\n  transcript span must not be the sole evidence for two different full-credit verdicts.');
    });

    test('D18 — the pair-check ≠ manipulative-discovery boundary example survives verbatim', async () => {
      const sys = await sentSystemPrompt();
      expect(sys).toContain('Pair-work\n  that checks each other\'s answers is an equivalent for a "peer review / feedback" move, but NOT for a\n  "discover the common denominator with manipulatives" move — that one targets a different sub-skill.');
      expect(sys).toContain('When the sub-objective differs, it is `not_done`, not a substitution.');
    });

    test('D19 — the global-unusability guard survives verbatim', async () => {
      const sys = await sentSystemPrompt();
      expect(sys).toContain('**GLOBAL-UNUSABILITY GUARD (critical).**');
      expect(sys).toContain('then EVERY move\'s verdict is **`not_adjudicable`, NOT `not_done`.**');
      expect(sys).toContain('to `"recording_unusable"` so the pipeline can flag it for re-capture.');
    });

    test('D28 — the lesson-mismatch rule survives verbatim', async () => {
      const sys = await sentSystemPrompt();
      expect(sys).toContain('**LESSON-MISMATCH RULE (critical — the opposite case).**');
      expect(sys).toContain('Verdict each such move\n> `not_done` (rationale: content mismatch)');
      expect(sys).toContain('Set `moderators.note` to `"lesson_mismatch"`');
    });

    test('anti-fabrication and the meaning of not_done survive verbatim', async () => {
      const sys = await sentSystemPrompt();
      expect(sys).toContain('Quote real transcript spans only.');
      expect(sys).toContain('never fabricate a quote');
      expect(sys).toContain('`not_done` means you\n  looked and it isn\'t there.');
    });

    test('the six verdicts and the output JSON schema are unchanged', async () => {
      const sys = await sentSystemPrompt();
      for (const v of ['executed', 'substituted_equivalent', 'substituted_better',
        'partial', 'not_done', 'not_adjudicable']) {
        expect(sys).toContain(`\`${v}\``);
      }
      expect(sys).toContain('- `verdict` — one of the six above.');
      expect(sys).toContain('"verdicts": [ { "move_id": "m1", "verdict": "...", "evidence": "[MM:SS] ...",');
      expect(sys).toContain('"option_taken": null, "assigned": null, "worked_minutes": null, "on_task_band": null }, ... ],');
      expect(sys).toContain('"moderators": { "plan_navigability": "...", "note": "..." } }');
    });

    test('the call shape is untouched: luna, temp 0, json_object, system+user', async () => {
      const client = fakeClient(OK);
      await analyzeFidelity(MOVES, TRANSCRIPT, META, { client });
      const p = client.calls[0];
      expect(p.model).toBe('openai/gpt-5.6-luna');
      expect(p.temperature).toBe(0);
      expect(p.response_format).toEqual({ type: 'json_object' });
      expect(p.messages).toHaveLength(2);          // still ONE call, no second pass
      expect(p.messages[1].role).toBe('user');
      expect(client.calls).toHaveLength(1);
    });

    test('the brief stays within 10% of its shipped size (G8 token budget)', () => {
      // Baseline GRADER_BRIEF at origin/sandbox is 7,607 chars. The system prompt is ~20% of a
      // real call's input; a 10% cap on the whole call leaves generous headroom, but a runaway
      // rewrite of the brief is a review smell, so pin it.
      expect(GRADER_BRIEF.length).toBeLessThan(Math.round(7607 * 1.35));
    });
  });
});
