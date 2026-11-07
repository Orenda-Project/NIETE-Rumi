'use strict';
// bd-rj6w0n.14.16.6 — the v10 moves step at runtime: a port of extract_moves.py's deterministic halves
// (prompt, revision drop, code-applied tags, stamp) around one injected model call.
const { buildPrompt, applyTags, extractMoves } = require('../../shared/services/lp-v10-card/moves');

const fakeClient = (content) => {
  const calls = [];
  return {
    calls,
    chat: { completions: { create: async (req) => { calls.push(req); return { choices: [{ message: { content } }], usage: {} }; } } },
  };
};

describe('lp-v10-card moves', () => {
  test('prompt is the offline drone prompt: header, brief, lesson id, the lesson as JSON', () => {
    const p = buildPrompt({ title: 'Add' }, 'nbf_snc_grade_3_maths.c01.s001', 'BRIEF');
    expect(p).toBe('FIDELITY-EXTRACT drone\nBRIEF\n\nLESSON PLAN TEXT (lesson_id=nbf_snc_grade_3_maths.c01.s001):\n{"title":"Add"}');
  });

  test('a revision lesson drops the spine the renderer does not show', () => {
    const p = buildPrompt({ revisionPanels: [1], iDo: 'x', exit: 'y', title: 'R' }, 'L', 'B');
    expect(p).not.toMatch(/iDo|exit/);
    expect(p).toMatch(/revisionPanels/);
  });

  test('tags: defaults, time on task for independent, several exits collapse to one choose_one', () => {
    const moves = applyTags([
      { move_id: 'm1', phase: 'independent', text: 'do' },
      { move_id: 'm2', phase: 'exit', text: 'a' },
      { move_id: 'm3', phase: 'exit', text: 'b' },
    ], 'STANDARD');
    expect(moves.map((m) => m.move_id)).toEqual(['m1', 'm2']);
    expect(moves[0]).toMatchObject({ track_time_on_task: true, selection: 'none', adjudicable: true });
    expect(moves[1]).toMatchObject({ selection: 'choose_one', type: 'check', source_field: 'exit[] (choose one)' });
    expect(moves[1].text).toBe('Run ONE exit check — teacher picks any one (or a better equivalent): (1) a | (2) b');
  });

  test('revision exits are per_group adaptive_set', () => {
    const [m] = applyTags([{ phase: 'exit', bucket: 'must_happen' }], 'REVISION');
    expect(m).toMatchObject({ selection: 'per_group', bucket: 'adaptive_set' });
  });

  test('extractMoves calls the model once and stamps the fidelity-moves-v1 output', async () => {
    const client = fakeClient('```json\n{"template":"STANDARD","total_minutes":40,"moves":[{"move_id":"m1","phase":"explain","bucket":"must_happen","text":"t"}]}\n```');
    const out = await extractMoves({ lpDoc: { title: 'T' }, lessonId: 'L1', client, model: 'm-x' });
    expect(client.calls[0].reasoning).toEqual({ enabled: false }); // thinking off, as the card and ICT's author
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({ model: 'm-x', job: 'lp.v10moves', temperature: 0 });
    expect(out).toMatchObject({
      schema_version: 'fidelity-moves-v1', lesson_id: 'L1', template: 'STANDARD', total_minutes: 40,
      model: 'm-x', lp_version: 'v9', source_format: 'lp_doc',
    });
    expect(out.moves[0]).toMatchObject({ move_id: 'm1', bucket: 'must_happen', selection: 'none' });
    expect(out.brief_sha).toMatch(/^[0-9a-f]{12}$/);
  });

  test('a reply with no moves is an error, not an empty card', async () => {
    const client = fakeClient('{"moves":[]}');
    await expect(extractMoves({ lpDoc: {}, lessonId: 'L', client, model: 'm' })).rejects.toThrow(/no moves/);
  });
});
