'use strict';
/**
 * bd-b3pop.11 / .15 — the grader call: provider knobs, photo evidence inside its data boundary, and a grading that
 * cannot be trusted (cut off by the token cap, or verdicts that name no prescribed move) is retried and then reported,
 * never scored. Everything unset and no photos = today's request, key for key.
 */
const { analyzeFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-analyzer');
const { GRADER_BRIEF, buildUserPrompt } = require('../../../bot/shared/services/coaching/fidelity/grader-prompt');

function fakeClient(answers) {
  const calls = [];
  const queue = Array.isArray(answers) ? [...answers] : null;
  return {
    calls,
    chat: {
      completions: {
        create: async (p) => {
          calls.push(p);
          const a = queue ? queue.shift() : answers;
          const { content, finish } = typeof a === 'string' ? { content: a, finish: 'stop' } : a;
          return { choices: [{ message: { content }, finish_reason: finish }], usage: {} };
        },
      },
    },
  };
}
const MOVES = [
  { move_id: 'm1', phase: 'explain', type: 'modelling', text: 'Write the three new words on the board', bucket: 'must_happen', selection: 'none' },
  { move_id: 'm2', phase: 'exit', type: 'check', text: 'Exit ticket', bucket: 'must_happen', selection: 'none' },
];
const META = { lesson_id: 'L' };
const GOOD = JSON.stringify({ verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[05:00] x' }, { move_id: 'm2', verdict: 'not_done', evidence: '' }] });
const KNOBS = ['LP_FIDELITY_REASONING_EFFORT', 'LP_FIDELITY_MAX_TOKENS', 'LP_FIDELITY_PROMPT_VERSION'];
const PHOTO = [{ n: 2, kind: 'board', visible_text: 'جھکڑ\nتاب کاری', drawings: '', students: '', learning_materials: [], student_work: '' }];

describe('fidelity-analyzer · provider knobs, photo evidence, untrustworthy gradings', () => {
  const saved = {};
  beforeEach(() => { for (const k of KNOBS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KNOBS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  test("everything unset → today's request exactly (keys, brief, user message, token cap)", async () => {
    const client = fakeClient(GOOD);
    await analyzeFidelity(MOVES, '[05:00] t', META, { client });
    const p = client.calls[0];
    expect(Object.keys(p)).toEqual(['model', 'temperature', 'messages', 'max_completion_tokens', 'response_format']);
    expect(p.messages[0].content).toBe(GRADER_BRIEF);
    expect(p.messages[1].content).toBe(buildUserPrompt(META, MOVES, '[05:00] t'));
    expect(p.max_completion_tokens).toBe(4000);
  });

  test('LP_FIDELITY_PROMPT_VERSION no longer changes anything (the parked v2 prompt was removed)', async () => {
    process.env.LP_FIDELITY_PROMPT_VERSION = 'v2';
    const client = fakeClient(GOOD);
    await analyzeFidelity(MOVES, '[05:00] t', META, { client });
    expect(client.calls[0].messages[0].content).toBe(GRADER_BRIEF);
    expect(client.calls[0].messages[1].content).toBe(buildUserPrompt(META, MOVES, '[05:00] t'));
  });

  test('a normal answer returns its verdicts, no reasoning effort and no missing verdicts', async () => {
    const out = await analyzeFidelity(MOVES, 't', META, { client: fakeClient(GOOD) });
    expect(out).toMatchObject({ reasoning_effort: null, missing_verdicts: 0 });
    for (const gone of ['prompt_version', 'recording', 'lesson_identity', 'lesson_stretches', 'photo_evidence_count']) expect(out).not.toHaveProperty(gone);
    expect(out.verdicts).toHaveLength(2);
  });

  test('LP_FIDELITY_REASONING_EFFORT and LP_FIDELITY_MAX_TOKENS reach the request', async () => {
    process.env.LP_FIDELITY_REASONING_EFFORT = 'low';
    process.env.LP_FIDELITY_MAX_TOKENS = '16000';
    const client = fakeClient(GOOD);
    const out = await analyzeFidelity(MOVES, 't', META, { client });
    expect(client.calls[0].reasoning).toEqual({ effort: 'low' });
    expect(client.calls[0].max_completion_tokens).toBe(16000);
    expect(out.reasoning_effort).toBe('low');
  });

  test('LP_FIDELITY_MAX_TOKENS is floored and clamped to 32000; a value below 1 or junk falls back to 4000', async () => {
    for (const [raw, want] of [['16000.9', 16000], ['99999', 32000], ['0.5', 4000], ['16k', 4000]]) {
      process.env.LP_FIDELITY_MAX_TOKENS = raw;
      const client = fakeClient(GOOD);
      await analyzeFidelity(MOVES, 't', META, { client });
      expect(client.calls[0].max_completion_tokens).toBe(want);
    }
  });

  test('an unknown effort value is ignored, never sent', async () => {
    process.env.LP_FIDELITY_REASONING_EFFORT = 'turbo';
    const client = fakeClient(GOOD);
    await analyzeFidelity(MOVES, 't', META, { client });
    expect(client.calls[0].reasoning).toBeUndefined();
  });

  test('empty content on the first attempt → the retry asks for low reasoning effort', async () => {
    const client = fakeClient([{ content: '', finish: 'length' }, GOOD]);
    const out = await analyzeFidelity(MOVES, 't', META, { client });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0].reasoning).toBeUndefined();
    expect(client.calls[1].reasoning).toEqual({ effort: 'low' });
    expect(out.verdicts).toHaveLength(2);
  });

  test('two empty answers → fidelity_unavailable carrying the reason', async () => {
    const empty = { content: '', finish: 'length' };
    await expect(analyzeFidelity(MOVES, 't', META, { client: fakeClient([empty, empty]) }))
      .rejects.toMatchObject({ code: 'fidelity_unavailable', reason: 'empty_content' });
  });

  test('a grading cut off by the token cap with a move unjudged is retried, never scored as a miss', async () => {
    const cut = { content: JSON.stringify({ verdicts: [{ move_id: 'm1', verdict: 'executed', evidence: '[05:00] x' }] }), finish: 'length' };
    const client = fakeClient([cut, GOOD]);
    const out = await analyzeFidelity(MOVES, 't', META, { client });
    expect(client.calls).toHaveLength(2);
    expect(out.verdicts).toHaveLength(2);
    await expect(analyzeFidelity(MOVES, 't', META, { client: fakeClient([cut, cut]) })).rejects.toMatchObject({ reason: 'truncated' });
  });

  test('verdicts that name no prescribed move are retried, then reported (index-keyed answers)', async () => {
    const bad = JSON.stringify({ verdicts: { 1: { verdict: 'executed' }, 2: { verdict: 'executed' } } });
    await expect(analyzeFidelity(MOVES, 't', META, { client: fakeClient([bad, bad]) })).rejects.toMatchObject({ reason: 'incomplete_verdicts' });
  });

  test('verdicts keyed by move_id become the array the scorer reads; an unjudged move without truncation is counted', async () => {
    const out = await analyzeFidelity(MOVES, 't', META, { client: fakeClient(JSON.stringify({ verdicts: { m1: { verdict: 'partial', evidence: '[01:00] e' } } })) });
    expect(out.verdicts).toEqual([{ move_id: 'm1', verdict: 'partial', evidence: '[01:00] e' }]);
    expect(out.missing_verdicts).toBe(1);
  });

  test('a null verdict entry is dropped instead of crashing the scorer', async () => {
    const out = await analyzeFidelity(MOVES, 't', META, {
      client: fakeClient(JSON.stringify({ verdicts: [null, { move_id: 'm1', verdict: 'executed', evidence: 'e' }, { move_id: 'm2', verdict: 'partial', evidence: 'e' }] })),
    });
    expect(out.verdicts).toHaveLength(2);
  });

  test('photo evidence → the photo rules on the brief, the reading inside its data boundary after the transcript', async () => {
    const { PHOTO_EVIDENCE_SECTION } = require('../../../bot/shared/services/coaching/fidelity/grader-photo-evidence');
    const client = fakeClient(GOOD);
    await analyzeFidelity(MOVES, '[05:00] t', META, { client, photoEvidence: PHOTO });
    const p = client.calls[0];
    expect(p.messages[0].content).toBe(GRADER_BRIEF + PHOTO_EVIDENCE_SECTION);
    const user = p.messages[1].content;
    expect(user.startsWith(buildUserPrompt(META, MOVES, '[05:00] t'))).toBe(true);
    expect(user).toContain('<classroom_photo_evidence>');
    expect(user.endsWith('</classroom_photo_evidence>')).toBe(true);
    expect(user).toContain('[photo 2] kind: board\nwriting: جھکڑ / تاب کاری');
  });
});
