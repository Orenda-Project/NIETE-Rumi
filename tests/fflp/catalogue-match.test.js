'use strict';
/**
 * Free-form lesson plans — the catalogue lookup on a typed topic (NIETE).
 *
 * A typed topic that the catalogue already holds must keep getting the catalogue (a HIT is never
 * changed). The lookup ranks by token overlap against the K-5 v8 catalogue titles
 * (bot/data/lp_catalog.json: chapter titles + lesson topics) and the Grades 6-12 segment titles
 * (niete_lp612_segments: subtopic_title / menu_title / chapter_title, the same is_current +
 * grade-band + religious-hold filters the 6-12 browser applies). A lookup that cannot run is a
 * HIT: on any doubt, today's catalogue answer.
 */
const mockReads = [];
let mockSegRows = [];
let mockThrow = null;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = { table, ops: [] };
    mockReads.push(q);
    const b = {};
    for (const op of ['select', 'eq', 'gte', 'lte']) b[op] = jest.fn((...a) => { q.ops.push([op, ...a]); return b; });
    b.range = jest.fn(async (from, to) => {
      q.ops.push(['range', from, to]);
      if (mockThrow) return { data: null, error: { message: mockThrow } };
      return { data: mockSegRows.slice(from, to + 1), error: null };
    });
    return b;
  }),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const M = require('../../bot/shared/services/fflp/catalogue-match');

beforeEach(() => { M._resetCache(); mockReads.length = 0; mockSegRows = []; mockThrow = null; delete process.env.LP_612_RELIGIOUS_ENABLED; });

describe('normalise / tokens', () => {
  test('lower-cases, strips Latin diacritics and Arabic-script harakat, folds ي/ى→ی and ك→ک and ه→ہ', () => {
    expect(M.normalise('Café  FRACTIONS')).toBe('cafe fractions');
    expect(M.normalise('كتاب')).toBe('کتاب');
    expect(M.normalise('علي')).toBe('علی');
    expect(M.normalise('مَدرَسة')).toBe(M.normalise('مدرسة'));
    expect(M.normalise('هوا')).toBe('ہوا');
  });
  test('drops request words, grade/class words, subject names and numbers; folds an English plural', () => {
    expect(M.tokens('Please make a lesson plan on Fractions for grade 3 maths')).toEqual(['fraction']);
    expect(M.tokens('جماعت سوم کے لیے پودے پر سبق')).toEqual(['پودے']);
    expect(M.tokens('lesson plan')).toEqual([]);
  });
});

describe('match() — ranking against a title list', () => {
  const TITLES = [
    { title: 'Adding Fractions', source: 'v8' },
    { title: 'Photosynthesis in Plants', source: 'lp612' },
    { title: 'ہمارا ماحول', source: 'v8' },
  ];
  test('HIT: every content word is in one title', () => {
    expect(M.match('lesson plan on fractions grade 4', TITLES)).toMatchObject({ hit: true, score: 1, title: 'Adding Fractions' });
  });
  test('HIT: an Urdu topic', () => {
    expect(M.match('ہمارا ماحول', TITLES)).toMatchObject({ hit: true, title: 'ہمارا ماحول' });
  });
  test('HIT at the threshold (half the content words)', () => {
    const r = M.match('photosynthesis and volcanoes', TITLES);
    expect(r.score).toBeGreaterThanOrEqual(M.THRESHOLD);
    expect(r.hit).toBe(true);
  });
  test('MISS: no content word in any title', () => {
    expect(M.match('volcanoes and earthquakes', TITLES)).toMatchObject({ hit: false, score: 0, reason: 'below_threshold' });
  });
  test('a bare ask with no topic word is a HIT (the catalogue is the answer)', () => {
    expect(M.match('lesson plan please', TITLES)).toMatchObject({ hit: true, reason: 'no_topic' });
  });
});

describe('matchTopic() — the live lookup', () => {
  test('reads the v8 catalogue file and the 6-12 segments (same servable filters), and ranks across both', async () => {
    mockSegRows = [{ subtopic_title: 'Quasar spectra and redshift', menu_title: 'Quasars', chapter_title: 'Deep space' }];
    const r = await M.matchTopic('quasar spectra');
    expect(r).toMatchObject({ hit: true, source: 'lp612' });
    const q = mockReads[0];
    expect(q.table).toBe('niete_lp612_segments');
    expect(q.ops).toEqual(expect.arrayContaining([['eq', 'is_current', true], ['gte', 'grade', 6], ['lte', 'grade', 12], ['eq', 'is_religious', false]]));
    // a K-5 title from the real catalogue file is a hit with no 6-12 row
    const v8 = require('../../bot/data/lp_catalog.json');
    const lessonTopic = v8.books[0].chapters[0].lessons[0].topic;
    expect((await M.matchTopic(lessonTopic)).hit).toBe(true);
  });
  test('titles are cached: two lookups, one segment read', async () => {
    await M.matchTopic('quasar');
    await M.matchTopic('volcanoes');
    expect(mockReads).toHaveLength(1);
  });
  test('the religious hold is the browser\'s: with it lifted, no is_religious filter', async () => {
    process.env.LP_612_RELIGIOUS_ENABLED = 'true';
    await M.matchTopic('volcanoes');
    expect(mockReads[0].ops.find((o) => o[1] === 'is_religious')).toBeUndefined();
  });
  test('a segment read that fails is a HIT (on doubt: the catalogue), never a throw', async () => {
    mockThrow = 'timeout';
    await expect(M.matchTopic('volcanoes and earthquakes')).resolves.toMatchObject({ hit: true, reason: 'lookup_failed' });
  });
  test('pages past 1,000 rows (PostgREST max-rows)', async () => {
    mockSegRows = Array.from({ length: 1001 }, (_, i) => ({ subtopic_title: `Row ${i}`, menu_title: null, chapter_title: null }));
    mockSegRows[1000].subtopic_title = 'Tectonic plates';
    expect((await M.matchTopic('tectonic plates')).hit).toBe(true);
  });
});

describe('Urdu stop-words survive normalise()', () => {
  test('«سائنس کا سبق بنائیں» has no content words (every word is a stop word once normalised)', () => {
    expect(M.tokens('سائنس کا سبق بنائیں')).toEqual([]);
  });
  test('«برائے» and «بنائیں» are dropped around a real topic word', () => {
    expect(M.tokens('ضیائی تالیف برائے جماعت ہفتم سبق بنائیں')).toEqual([M.normalise('ضیائی'), M.normalise('تالیف')]);
  });
  test('a catalogue topic typed in Urdu with those words is a HIT, not a MISS', () => {
    const titles = [{ title: 'ضیائی تالیف', source: 'lp612' }];
    expect(M.match('سائنس میں ضیائی تالیف پر سبق بنائیں برائے جماعت ہفتم', titles)).toMatchObject({ hit: true, score: 1 });
  });
});

