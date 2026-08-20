'use strict';
/**
 * P3.1 — fidelity LLM grader. The LLM is MOCKED (an injected client) — determinism of the CALL
 * SHAPE and PARSING is what's under test, not the model. Encodes D6/D8/D18/D19/D20.
 */
const { analyzeFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-analyzer');
const { scoreFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-scorer');
const { buildUserPrompt } = require('../../../bot/shared/services/coaching/fidelity/grader-prompt');

// a fake OpenRouter client: records the params, returns whatever JSON string we hand it
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
  { move_id: 'm1', phase: 'explain', type: 'modelling', text: 'Model adding unlike fractions via LCM', bucket: 'must_happen', selection: 'none', track_time_on_task: false, prescribed_minutes: null, adjudicable: true },
  { move_id: 'm2', phase: 'exit', type: 'check', text: 'Exit ticket', bucket: 'must_happen', selection: 'choose_one', track_time_on_task: false, prescribed_minutes: null, adjudicable: true },
];
const META = { lesson_id: 'L1', template: 'STANDARD', goal: 'add unlike fractions', total_minutes: 30 };
const TRANSCRIPT = '[05:00] Teacher: LCM le lo char aur teen ka…';

describe('fidelity-analyzer (LLM mocked)', () => {
  test('calls luna in json_object mode with the grader system prompt + moves + transcript', async () => {
    const good = JSON.stringify({ verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[05:00] LCM…' }], narrative: 'ok' });
    const client = fakeClient(good);
    await analyzeFidelity(MOVES, TRANSCRIPT, META, { client });
    const p = client.calls[0];
    expect(p.model).toBe('openai/gpt-5.6-luna');
    expect(p.temperature).toBe(0);
    expect(p.response_format).toEqual({ type: 'json_object' });
    expect(p.messages[0].role).toBe('system');
    expect(p.messages[0].content).toContain('FIDELITY GRADER');
    // user message carries the moves + the transcript
    expect(p.messages[1].content).toContain('m1');
    expect(p.messages[1].content).toContain('add unlike fractions');
    expect(p.messages[1].content).toContain('LCM le lo char aur teen');
  });

  test('the grader is NOT shown the deterministic bucket tag (D6 — no gaming the score)', () => {
    const user = buildUserPrompt(META, MOVES, TRANSCRIPT);
    expect(user).toContain('"selection"');
    expect(user).not.toContain('must_happen'); // bucket withheld
  });

  test('returns verdicts + narrative + language_note + moderators; never a score', async () => {
    const payload = {
      language_note: 'Urdu with English maths terms',
      verdicts: [{ move_id: 'm1', verdict: 'executed' }, { move_id: 'm2', verdict: 'partial', option_taken: 'short-answer' }],
      narrative: 'She modelled the method and started an exit check.',
      moderators: { plan_navigability: 'clear', note: '' },
    };
    const out = await analyzeFidelity(MOVES, TRANSCRIPT, META, { client: fakeClient(JSON.stringify(payload)) });
    expect(out.verdicts).toHaveLength(2);
    expect(out.narrative).toMatch(/exit check/);
    expect(out.language_note).toMatch(/Urdu/);
    expect(out.moderators.plan_navigability).toBe('clear');
    expect(out).not.toHaveProperty('fidelity_pct'); // analyzer never scores
    expect(out.usage.completion_tokens).toBe(50);
  });

  test('jsonrepair rescues a slightly-malformed payload (trailing comma)', async () => {
    const sloppy = '{ "verdicts": [ { "move_id": "m1", "verdict": "executed", } ], "narrative": "ok", }';
    const out = await analyzeFidelity(MOVES, TRANSCRIPT, META, { client: fakeClient(sloppy) });
    expect(out.verdicts[0].verdict).toBe('executed');
  });

  test('unparseable output → throws fidelity_unavailable after a retry (caller must guard, never fail the job)', async () => {
    const client = fakeClient('this is not json at all <<<');
    await expect(analyzeFidelity(MOVES, TRANSCRIPT, META, { client })).rejects.toMatchObject({ code: 'fidelity_unavailable' });
    expect(client.calls).toHaveLength(2); // one retry
  });

  test('composes with the scorer: garble guard (all not_adjudicable) → recording_unusable, null pct (D19/D20)', async () => {
    const garble = JSON.stringify({
      language_note: 'transcript is garbled, no usable timestamps',
      verdicts: [{ move_id: 'm1', verdict: 'not_adjudicable' }, { move_id: 'm2', verdict: 'not_adjudicable' }],
      moderators: { note: 'recording_unusable' },
    });
    const out = await analyzeFidelity(MOVES, TRANSCRIPT, META, { client: fakeClient(garble) });
    const analysis = scoreFidelity(MOVES, out.verdicts);
    expect(analysis.fidelity_pct).toBeNull();
    expect(analysis.recording_unusable).toBe(true);
  });

  test('composes with the scorer: real verdicts → the D20 analysis blob (pct + per-move evidence)', async () => {
    const payload = JSON.stringify({
      verdicts: [
        { move_id: 'm1', verdict: 'executed', evidence: '[05:00] LCM…', evidence_translation: 'take the LCM' },
        { move_id: 'm2', verdict: 'not_done', evidence: '' },
      ],
      narrative: 'Modelled the method; no exit check.',
    });
    const out = await analyzeFidelity(MOVES, TRANSCRIPT, META, { client: fakeClient(payload) });
    const analysis = scoreFidelity(MOVES, out.verdicts);
    expect(analysis.fidelity_pct).toBe(50); // 1 of 2 must_happen
    expect(analysis.moves.find((m) => m.move_id === 'm1').evidence).toContain('[05:00]');
  });
});
