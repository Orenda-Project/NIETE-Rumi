'use strict';
/**
 * bd-ra8xu.60 — Observation Notes into the DC: the INFORMED v6 scoring (prompt fico17-v6-dc-notes-1).
 *
 * The informed run reads the same transcript as the blind v6 scoring, plus the coach's Observation Notes after it. It
 * may cite a note as evidence ({source:"note", note_id, quote}); every such quote must be in that note word for word,
 * or it is dropped and counted as made-up support. It labels every note supports / contradicts / not_in_recording,
 * and still gives no level for the six combined indicators. The model call is mocked at the LLM boundary
 * (GPT5MiniService.analyzePedagogy); everything in the informed module runs for real.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ analyzePedagogy: jest.fn() }));

const GPT5 = require('../../bot/shared/services/gpt5-mini.service');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const informed = require('../../bot/shared/services/coaching/frameworks/fico17-v6/informed');

const TRANSCRIPT = [
  '[00:10] Teacher (EN): Good morning children, today we add two numbers.',
  '[01:00] Teacher (EN): Is this right?',
  '[01:05] Student (EN): Yes.',
  '[06:12] Teacher (EN): Is this right? Tell me.',
  '[06:20] Student (EN): Yes miss.',
  '[12:40] Teacher (EN): Now each of you come to the board.',
  '[20:00] Teacher (EN): Well done, see you tomorrow.',
].join('\n');

const NOTES = [
  { id: 'n1', text: 'Board work: 5 children solved sums with steps; she asked each one how they got it.', rec_time: '12:40', typed_before_review: true },
  { id: 'n2', text: 'Back two rows silent all lesson; she only picked front benches.', rec_time: null, typed_before_review: true },
];

function reply(overrides = {}) {
  const levels = {};
  for (const c of v6.DC_CODES) levels[c] = { result: 2, because: 'closed questions only', evidence: [{ time: '06:12', quote: 'Is this right? Tell me.' }] };
  const combined = {};
  for (const c of ['C3', 'C5', 'C7', 'D3', 'D4']) combined[c] = { result: null, items: [] };
  return {
    rubric: 'fico17_v6',
    levels,
    combined_evidence: combined,
    notes: [
      { note_id: 'n1', codes: ['C1'], label: 'not_in_recording' },
      { note_id: 'n2', codes: ['C3'], label: 'not_in_recording' },
    ],
    ...overrides,
  };
}

describe('the informed prompt', () => {
  test('has its own prompt version, and the system prompt teaches note citations and labels', () => {
    expect(informed.NOTES_PROMPT_VERSION).toBe(`fico17-v6-dc-notes-1+${v6.RUBRIC_SHA8}`);
    const fw = informed.informedVariant(NOTES);
    expect(fw.promptVersion).toBe(informed.NOTES_PROMPT_VERSION);
    const sys = fw.getSystemPrompt();
    expect(sys).toContain('OBSERVATION NOTES');
    expect(sys).toContain('"source": "note"');
    expect(sys).toMatch(/supports.*contradicts.*not_in_recording/s);
    // Still the v6 scorer underneath: the same Part 1 / Part 2 rules.
    expect(sys).toContain('PART 2 – EVIDENCE ONLY');
  });

  test('the user prompt puts the notes AFTER the transcript, each with its id and recording time', () => {
    const fw = informed.informedVariant(NOTES);
    const p = fw.buildAnalysisPrompt(TRANSCRIPT, { grade: '3' });
    const tx = p.indexOf('TRANSCRIPT:');
    const notes = p.indexOf('OBSERVATION NOTES');
    expect(tx).toBeGreaterThanOrEqual(0);
    expect(notes).toBeGreaterThan(tx + TRANSCRIPT.length);
    expect(p).toContain('[n1] (12:40) Board work: 5 children solved sums');
    expect(p).toContain('[n2] Back two rows silent');
    expect(p.trim().endsWith('Return only the JSON.')).toBe(true);
  });

  test('a note with no text is never sent', () => {
    const fw = informed.informedVariant([...NOTES, { id: 'n3', text: '   ' }]);
    expect(fw.buildAnalysisPrompt(TRANSCRIPT, {})).not.toContain('[n3]');
  });
});

describe('validateInformed', () => {
  test('a note quote found word for word in its note is kept beside the transcript evidence', () => {
    const a = reply();
    a.levels.C1 = {
      result: 3, because: 'the note shows open questions at the board',
      evidence: [{ time: '06:12', quote: 'Is this right? Tell me.' }, { source: 'note', note_id: 'n1', quote: 'she asked each one how they got it' }],
    };
    const out = informed.validateInformed(a, TRANSCRIPT, NOTES);
    expect(out.ok).toBe(true);
    expect(a.levels.C1.evidence).toHaveLength(2);
    expect(a.levels.C1.evidence[1]).toEqual({ source: 'note', note_id: 'n1', quote: 'she asked each one how they got it' });
    expect(out.note_evidence).toBe(1);
    expect(out.made_up).toEqual([]);
  });

  test('a note quote that is not in that note is dropped and counted as made-up support', () => {
    const a = reply();
    a.levels.C1.evidence = [
      { source: 'note', note_id: 'n1', quote: 'she asked why after every answer' }, // not what the note says
      { source: 'note', note_id: 'n9', quote: 'Board work' }, // no such note
      { source: 'note', note_id: 'n2', quote: 'Board work' }, // in n1, not in n2
    ];
    const out = informed.validateInformed(a, TRANSCRIPT, NOTES);
    expect(out.ok).toBe(true);
    expect(a.levels.C1.evidence).toEqual([]);
    expect(out.made_up).toEqual([
      { code: 'C1', note_id: 'n1', quote: 'she asked why after every answer', why: 'not_in_note' },
      { code: 'C1', note_id: 'n9', quote: 'Board work', why: 'unknown_note' },
      { code: 'C1', note_id: 'n2', quote: 'Board work', why: 'not_in_note' },
    ]);
  });

  test('transcript evidence is still checked against the transcript (±30 s), as the blind validator does', () => {
    const a = reply();
    a.levels.C2.evidence = [{ time: '01:00', quote: 'Is this right?' }, { time: '15:00', quote: 'Is this right?' }];
    const out = informed.validateInformed(a, TRANSCRIPT, NOTES);
    expect(out.ok).toBe(true);
    expect(a.levels.C2.evidence).toEqual([{ time: '01:00', quote: 'Is this right?' }]);
    expect(out.dropped).toBeGreaterThanOrEqual(1);
  });

  test('a note may be cited as evidence for one of the six, but the six still get no level', () => {
    const a = reply();
    a.combined_evidence.C3 = { result: null, items: [{ source: 'note', note_id: 'n2', quote: 'she only picked front benches' }] };
    const ok = informed.validateInformed(a, TRANSCRIPT, NOTES);
    expect(ok.ok).toBe(true);
    expect(a.combined_evidence.C3.items).toEqual([{ source: 'note', note_id: 'n2', quote: 'she only picked front benches' }]);

    const graded = reply();
    graded.levels.C3 = { result: 4, because: 'the note', evidence: [] };
    const out = informed.validateInformed(graded, TRANSCRIPT, NOTES);
    expect(out.ok).toBe(false);
    expect(out.errors.join(' ')).toMatch(/C3: a combined indicator has a DC level/);

    const combinedNumber = reply();
    combinedNumber.combined_evidence.C7 = { result: 3, items: [] };
    expect(informed.validateInformed(combinedNumber, TRANSCRIPT, NOTES).ok).toBe(false);
  });

  test('labels: known notes and labels kept, codes limited to the 17, a note without a label is listed', () => {
    const a = reply({
      notes: [
        { note_id: 'n1', codes: ['C1', 'X9'], label: 'contradicts' },
        { note_id: 'n1', codes: ['C2'], label: 'supports' }, // a second label for n1: the first wins
        { note_id: 'n7', codes: ['C1'], label: 'supports' }, // no such note
        { note_id: 'n2', codes: ['C3'], label: 'maybe' }, // not a label
      ],
    });
    const out = informed.validateInformed(a, TRANSCRIPT, NOTES);
    expect(out.ok).toBe(true);
    expect(a.notes).toEqual([{ note_id: 'n1', codes: ['C1'], label: 'contradicts' }]);
    expect(out.unlabeled).toEqual(['n2']);
  });
});

describe('scoreInformed', () => {
  beforeEach(() => GPT5.analyzePedagogy.mockReset());

  test('one model call with the informed variant; the stored blob carries the version, the notes it read, labels and made-up count', async () => {
    const a = reply();
    a.levels.C1 = { result: 3, because: 'note', evidence: [{ source: 'note', note_id: 'n1', quote: 'NOT IN THE NOTE' }] };
    GPT5.analyzePedagogy.mockResolvedValue({ analysis: a, usage: { cost: 0.021, input_tokens: 9000, output_tokens: 1200 } });
    const blob = await informed.scoreInformed(TRANSCRIPT, NOTES, { duration: 1200, coachingSessionId: 's1' });
    expect(GPT5.analyzePedagogy).toHaveBeenCalledTimes(1);
    const [, , , fw] = GPT5.analyzePedagogy.mock.calls[0];
    expect(fw.promptVersion).toBe(informed.NOTES_PROMPT_VERSION);
    expect(fw.buildAnalysisPrompt(TRANSCRIPT, {})).toContain('[n1]');
    expect(blob).toMatchObject({
      status: 'ok',
      rubric: 'fico17_v6',
      prompt_version: informed.NOTES_PROMPT_VERSION,
      note_ids: ['n1', 'n2'],
      made_up_note_support: 1,
      usage: { cost: 0.021 },
    });
    expect(blob.levels.C1.result).toBe(3);
    expect(blob.notes).toHaveLength(2);
    for (const c of v6.COMBINED_CODES) expect(blob.levels[c]).toBeUndefined();
    expect(blob.scores.rubric).toBe('fico17_v6');
    expect(typeof blob.at).toBe('string');
  });

  test('an invalid reply is stored as invalid, never as default levels', async () => {
    GPT5.analyzePedagogy.mockResolvedValue({ analysis: { levels: {} }, usage: {} });
    const blob = await informed.scoreInformed(TRANSCRIPT, NOTES, {});
    expect(blob.status).toBe('invalid');
    expect(blob.levels).toBeUndefined();
    expect(blob.prompt_version).toBe(informed.NOTES_PROMPT_VERSION);
  });

  test('a broken transcript makes no call', async () => {
    const blob = await informed.scoreInformed('', NOTES, {});
    expect(GPT5.analyzePedagogy).not.toHaveBeenCalled();
    expect(blob.status).toBe('broken');
  });

  test('no notes with text: no call', async () => {
    const blob = await informed.scoreInformed(TRANSCRIPT, [{ id: 'n1', text: '' }], {});
    expect(GPT5.analyzePedagogy).not.toHaveBeenCalled();
    expect(blob.status).toBe('no_notes');
  });
});
