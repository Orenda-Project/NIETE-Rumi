/**
 * v10 coaching test (bd-v0toag.100.8): the check judges the ask itself.
 *
 * Quratulain's week-1 review: the old check judged whichever moves shared the ask's practice tag, so an
 * ask in m2/m4 was judged on m1, and "pair" in m5 stood in for an ask in m1. Now one call reads the ask's
 * text, today's plan moves and the recording's transcript, and says did / partly / not_done /
 * couldnt_tell, naming the move it judged and quoting the evidence. Anything that cannot be judged
 * (no grading, no transcript, a failed call, a reply out of shape) is not_graded. Never throws.
 */
const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockLlm = { completeJson: jest.fn() };
jest.mock('../../bot/shared/services/gpt5-mini.service', () => ({ completeJson: (...a) => mockLlm.completeJson(...a) }));

const J = require('../../bot/shared/services/coaching/thing-to-try-judge');

const THING = { move_id: 'm2', lesson_id: 'grade_2_english_ch7_seg1', text: 'Ask two children to read the word to a partner.', tag: 'C9' };
const MOVES = [
  { move_id: 'm1', phase: 'warm_up', text: 'Sing the alphabet song.', verdict: 'executed' },
  { move_id: 'm4', phase: 'guided', text: 'Children read the word to a partner.', verdict: 'partial' },
];
const LPF = { status: 'ok', lesson_id: 'grade_2_english_ch8_seg1', moves: MOVES };

function transcript(text, { fail = false } = {}) {
  mockSupabase.from.mockImplementation(() => {
    const c = {
      select: () => c, eq: () => c,
      maybeSingle: async () => (fail ? { data: null, error: { message: 'boom' } } : { data: { transcript_text: text }, error: null }),
    };
    return c;
  });
}

beforeEach(() => { jest.clearAllMocks(); });

describe('judgePrompt', () => {
  const p = J.judgePrompt({ thing: THING, moves: MOVES, transcript: 'T: read to your partner' });
  test('carries the ask, every move with its id and step, the transcript, and asks for JSON', () => {
    expect(p).toContain(THING.text);
    expect(p).toContain('m1');
    expect(p).toContain('Children read the word to a partner.');
    expect(p).toContain('T: read to your partner');
    expect(p).toMatch(/JSON/);
    expect(p).toMatch(/couldnt_tell/);
  });

  test('a long transcript is cut to the cap', () => {
    const long = 'x'.repeat(J.TRANSCRIPT_CAP + 500);
    expect(J.judgePrompt({ thing: THING, moves: MOVES, transcript: long }).length)
      .toBeLessThan(J.TRANSCRIPT_CAP + 4000);
  });
});

describe('readVerdict', () => {
  test.each(['did', 'partly', 'not_done', 'couldnt_tell'])('%s is kept, with the move, evidence and why', (v) => {
    expect(J.readVerdict({ verdict: v, move_id: 'm4', evidence: ' "read to your partner" ', why: ' She said it. ' }, MOVES))
      .toEqual({ outcome: v, moveId: 'm4', evidence: '"read to your partner"', why: 'She said it.' });
  });

  test('a move id not in today\'s plan is dropped, the verdict stands', () => {
    expect(J.readVerdict({ verdict: 'did', move_id: 'm9' }, MOVES)).toEqual({ outcome: 'did', moveId: null, evidence: null, why: null });
  });

  test.each([[null], [{}], [{ verdict: 'yes' }], ['did']])('not_graded for %p', (r) => {
    expect(J.readVerdict(r, MOVES)).toEqual({ outcome: 'not_graded', moveId: null, evidence: null, why: null });
  });
});

describe('judgeThing', () => {
  test('one call over the transcript; its verdict comes back', async () => {
    transcript('T: now read the word to your partner. S: cat!');
    mockLlm.completeJson.mockResolvedValue({ result: { verdict: 'partly', move_id: 'm4', evidence: 'read the word to your partner', why: 'Only one pair read.' } });
    const out = await J.judgeThing({ thing: THING, lpFidelity: LPF, sessionId: 's2' });
    expect(out).toEqual({ outcome: 'partly', moveId: 'm4', evidence: 'read the word to your partner', why: 'Only one pair read.' });
    expect(mockLlm.completeJson).toHaveBeenCalledTimes(1);
    expect(mockLlm.completeJson.mock.calls[0][0]).toContain('S: cat!');
  });

  test.each([
    ['the recording was not graded', { status: 'lp_absent' }, 'T: hello'],
    ['no lp fidelity', null, 'T: hello'],
    ['no transcript', LPF, '   '],
  ])('not_graded, no call, when %s', async (_l, lpf, text) => {
    transcript(text);
    expect((await J.judgeThing({ thing: THING, lpFidelity: lpf, sessionId: 's2' })).outcome).toBe('not_graded');
    expect(mockLlm.completeJson).not.toHaveBeenCalled();
  });

  test('not_graded when the transcript read or the call fails', async () => {
    transcript(null, { fail: true });
    expect((await J.judgeThing({ thing: THING, lpFidelity: LPF, sessionId: 's2' })).outcome).toBe('not_graded');
    transcript('T: hello');
    mockLlm.completeJson.mockRejectedValue(new Error('down'));
    expect((await J.judgeThing({ thing: THING, lpFidelity: LPF, sessionId: 's2' })).outcome).toBe('not_graded');
  });
});
