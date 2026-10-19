/**
 * Live moves (bd-v0toag.31): the v10 card's moves for the live list.
 * The card JSON sits in R2 beside the current card PDF (same key, .card.json).
 * Never throws: no card row, an R2 error or junk JSON all give null.
 */
const fs = require('fs');
const path = require('path');

jest.mock('../../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../../bot/shared/storage/r2', () => ({ downloadFromR2: jest.fn() }));
jest.mock('../../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const { loadCardMoves, _resetCache } = require('../../../bot/shared/services/coaching/live-moves/card-store');

const CARD = fs.readFileSync(path.join(__dirname, 'fixtures/g4_english_ch12_seg1.card.json'));
const LESSON = 'grade_4_english_ch12_seg1';
const ROW = { lesson_id: LESSON, r2_key: 'lp-cache/v8/grade_4_english_ch12_seg1/abc123.card.pdf', version_stamp: 'v10card_prod_14Oct' };

function deps({ row = ROW, error = null, getObject } = {}) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: row, error })),
  };
  return {
    supabase: { from: jest.fn(() => chain) },
    getObject: getObject || jest.fn(async () => CARD),
    logEvent: jest.fn(),
    chain,
  };
}

beforeEach(() => _resetCache());

describe('loadCardMoves', () => {
  test('flattens sections into idx order and drops hw', async () => {
    const d = deps();
    const card = await loadCardMoves(LESSON, d);
    expect(card.lessonId).toBe(LESSON);
    expect(card.stamp).toBe('v10card_prod_14Oct');
    expect(card.sections.map((s) => s.sec)).toEqual(['open', 'explain', 'we', 'you', 'check']);
    expect(card.sections.map((s) => s.minutes)).toEqual([5, 8, 12, 12, 3]);
    const moves = card.sections.flatMap((s) => s.moves);
    expect(moves).toHaveLength(7);
    expect(moves.map((m) => m.idx)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(moves[3]).toEqual({
      idx: 3, covers: ['m6'], chip: 'I START, YOU FINISH',
      do: 'Read a meaning; class finds its picture and verb together.',
      say: '“To move hurriedly with short, quick steps. The verb is …” → “scurry!”',
    });
    expect(moves[0].chip).toBe('');
  });

  test('reads the JSON beside the current card PDF', async () => {
    const d = deps();
    await loadCardMoves(LESSON, d);
    expect(d.supabase.from).toHaveBeenCalledWith('niete_lp_assets');
    expect(d.chain.eq).toHaveBeenCalledWith('lesson_id', LESSON);
    expect(d.chain.eq).toHaveBeenCalledWith('asset_kind', 'card');
    expect(d.chain.eq).toHaveBeenCalledWith('is_current', true);
    expect(d.getObject).toHaveBeenCalledWith('lp-cache/v8/grade_4_english_ch12_seg1/abc123.card.json');
  });

  test('returns null when no card row', async () => {
    const d = deps({ row: null });
    expect(await loadCardMoves(LESSON, d)).toBeNull();
    expect(d.getObject).not.toHaveBeenCalled();
  });

  test('returns null and logs live_moves.card.failed on R2 error', async () => {
    const d = deps({ getObject: jest.fn(async () => { throw new Error('NoSuchKey'); }) });
    expect(await loadCardMoves(LESSON, d)).toBeNull();
    expect(d.logEvent).toHaveBeenCalledWith('live_moves.card.failed', expect.objectContaining({ lessonId: LESSON, error: 'NoSuchKey' }));
  });

  test('returns null on a supabase error or junk JSON', async () => {
    expect(await loadCardMoves(LESSON, deps({ error: { message: 'boom' } }))).toBeNull();
    _resetCache();
    expect(await loadCardMoves(LESSON, deps({ getObject: jest.fn(async () => Buffer.from('not json')) }))).toBeNull();
  });

  test('returns null for a missing lesson id without reading', async () => {
    const d = deps();
    expect(await loadCardMoves('', d)).toBeNull();
    expect(d.supabase.from).not.toHaveBeenCalled();
  });

  test('caches a card for 10 minutes per lesson', async () => {
    const d = deps();
    let t = 1000;
    d.now = () => t;
    await loadCardMoves(LESSON, d);
    t += 9 * 60 * 1000;
    await loadCardMoves(LESSON, d);
    expect(d.getObject).toHaveBeenCalledTimes(1);
    t += 2 * 60 * 1000;
    await loadCardMoves(LESSON, d);
    expect(d.getObject).toHaveBeenCalledTimes(2);
  });

  test('does not cache a failure', async () => {
    const d = deps({ row: null });
    await loadCardMoves(LESSON, d);
    await loadCardMoves(LESSON, d);
    expect(d.supabase.from).toHaveBeenCalledTimes(2);
  });
});
