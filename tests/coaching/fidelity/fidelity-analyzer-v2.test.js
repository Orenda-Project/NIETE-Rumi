'use strict';
/**
 * bd-b3pop.7 / .11 / .15 — the grader call: prompt version, provider knobs and photo evidence.
 * Every knob unset and no photo evidence = today's request, key for key: that guard must pass on today's code.
 */
const { analyzeFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-analyzer');
const { GRADER_BRIEF, buildUserPrompt } = require('../../../bot/shared/services/coaching/fidelity/grader-prompt');

function fakeClient(contents) {
  const calls = [];
  const queue = Array.isArray(contents) ? [...contents] : null;
  return {
    calls,
    chat: { completions: { create: async (p) => { calls.push(p); return { choices: [{ message: { content: queue ? queue.shift() : contents } }], usage: {} }; } } },
  };
}
const MOVES = [{ move_id: 'm1', phase: 'explain', type: 'modelling', text: 'Write the three new words on the board', bucket: 'must_happen', selection: 'none' }];
const META = { lesson_id: 'L' };
const GOOD_V1 = JSON.stringify({ verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[05:00] x' }] });
const GOOD_V2 = JSON.stringify({
  lesson_identity: { taught_topic: 't', mismatch: 'none' },
  lesson_stretches: [{ from: '[00:00]', to: '[05:00]', teacher: 't', students: 's' }],
  recording: { ends_at: '[20:00]', ends_mid_lesson: true, note: '' },
  verdicts: [{ move_id: 'm1', verdict: 'partial', action_core: 'write words', parts_present: ['[05:00] wrote'], parts_absent: ['third word'] }],
});
const KNOBS = ['LP_FIDELITY_PROMPT_VERSION', 'LP_FIDELITY_REASONING_EFFORT', 'LP_FIDELITY_MAX_TOKENS'];
const PHOTO = [{ n: 2, kind: 'board', visible_text: 'جھکڑ\nتاب کاری', drawings: '', students: '', learning_materials: [], student_work: '' }];

describe('fidelity-analyzer · prompt version, provider knobs, photo evidence', () => {
  const saved = {};
  beforeEach(() => { for (const k of KNOBS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KNOBS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test("everything unset → today's request exactly (keys, brief, user message, token cap)", async () => {
    const client = fakeClient(GOOD_V1);
    await analyzeFidelity(MOVES, '[05:00] t', META, { client, facts: { recording: { stamps: 1 } } });
    const p = client.calls[0];
    expect(Object.keys(p)).toEqual(['model', 'temperature', 'messages', 'max_completion_tokens', 'response_format']);
    expect(p.messages[0].content).toBe(GRADER_BRIEF);
    expect(p.messages[1].content).toBe(buildUserPrompt(META, MOVES, '[05:00] t'));
    expect(p.max_completion_tokens).toBe(4000);
  });

  test('LP_FIDELITY_PROMPT_VERSION=v2 → the v2 brief, the facts in the user message, the v2 fields returned', async () => {
    process.env.LP_FIDELITY_PROMPT_VERSION = 'v2';
    const { GRADER_BRIEF_V2 } = require('../../../bot/shared/services/coaching/fidelity/grader-prompt-v2');
    const client = fakeClient(GOOD_V2);
    const out = await analyzeFidelity(MOVES, '[05:00] t', META, {
      client, facts: { recording: { stamps: 1, ends_at: '05:00' }, anchors: { total: 0, found: [], missing: [] } },
    });
    const p = client.calls[0];
    expect(p.messages[0].content).toBe(GRADER_BRIEF_V2);
    expect(p.messages[1].content).toContain('RECORDING FACTS (measured by code — treat as given):\n{"stamps":1,"ends_at":"05:00"}');
    expect(p.messages[1].content).toContain('PLAN ANCHORS');
    expect(out).toMatchObject({ prompt_version: 'v2', recording: { ends_mid_lesson: true }, lesson_identity: { mismatch: 'none' } });
    expect(out.lesson_stretches).toHaveLength(1);
    expect(out.verdicts[0].parts_absent).toEqual(['third word']);
  });

  test('a v1 answer carries prompt_version v1 and null v2 fields', async () => {
    const out = await analyzeFidelity(MOVES, 't', META, { client: fakeClient(GOOD_V1) });
    expect(out).toMatchObject({ prompt_version: 'v1', reasoning_effort: null, recording: null, lesson_identity: null, lesson_stretches: null, photo_evidence_count: 0 });
  });

  test('LP_FIDELITY_REASONING_EFFORT and LP_FIDELITY_MAX_TOKENS reach the request', async () => {
    process.env.LP_FIDELITY_REASONING_EFFORT = 'low';
    process.env.LP_FIDELITY_MAX_TOKENS = '16000';
    const client = fakeClient(GOOD_V1);
    const out = await analyzeFidelity(MOVES, 't', META, { client });
    expect(client.calls[0].reasoning).toEqual({ effort: 'low' });
    expect(client.calls[0].max_completion_tokens).toBe(16000);
    expect(out.reasoning_effort).toBe('low');
  });

  test('an unknown effort value is ignored, never sent', async () => {
    process.env.LP_FIDELITY_REASONING_EFFORT = 'turbo';
    const client = fakeClient(GOOD_V1);
    await analyzeFidelity(MOVES, 't', META, { client });
    expect(client.calls[0].reasoning).toBeUndefined();
  });

  test('empty content on the first attempt → the retry asks for low reasoning effort', async () => {
    const client = fakeClient(['', GOOD_V1]);
    const out = await analyzeFidelity(MOVES, 't', META, { client });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0].reasoning).toBeUndefined();
    expect(client.calls[1].reasoning).toEqual({ effort: 'low' });
    expect(out.verdicts).toHaveLength(1);
  });

  test('verdicts returned as an object keyed by move_id become the array the scorer reads', async () => {
    const out = await analyzeFidelity(MOVES, 't', META, { client: fakeClient(JSON.stringify({ verdicts: { m1: { verdict: 'partial', evidence: '[01:00] e' } } })) });
    expect(out.verdicts).toEqual([{ move_id: 'm1', verdict: 'partial', evidence: '[01:00] e' }]);
  });

  test('photo evidence → the photo rules on the brief and one block per photo after the transcript', async () => {
    const { PHOTO_EVIDENCE_SECTION } = require('../../../bot/shared/services/coaching/fidelity/grader-photo-evidence');
    const client = fakeClient(GOOD_V1);
    const out = await analyzeFidelity(MOVES, '[05:00] t', META, { client, photoEvidence: PHOTO });
    const p = client.calls[0];
    expect(p.messages[0].content).toBe(GRADER_BRIEF + PHOTO_EVIDENCE_SECTION);
    expect(p.messages[1].content.startsWith(buildUserPrompt(META, MOVES, '[05:00] t'))).toBe(true);
    expect(p.messages[1].content).toContain('[photo 2] kind: board\nwriting: جھکڑ / تاب کاری');
    expect(out.photo_evidence_count).toBe(1);
  });
});
