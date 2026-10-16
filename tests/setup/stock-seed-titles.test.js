/**
 * The stock seed's titles are the passage files' titles.
 *
 * The child-facing title of a Challenge passage lives in its passage FILE (bot/shared/data/child-test/passages).
 * The committed stock seed (web_quiz_challenge_stock_seed.sql) writes each registry row's title_en / title_ur in its
 * INSERT; a re-titled file whose seed was not regenerated leaves a clean database with the old title. For every
 * passage_id the seed INSERTs, title_en and title_ur equal the file's (both NULL when the file has none).
 * This proves the committed file, not a database: a row written by an earlier seed is read on that database.
 */
const fs = require('fs');
const L = require('./challenge-data-gates-lib');

describe('the seed parser, on in-memory SQL', () => {
  const sql = [
    'INSERT INTO public.challenge_passages (passage_id, lang, band, title_en, title_ur, calib)',
    "VALUES ('en.read.1.x', 'en', 1, 'Imran''s Kite', NULL, '{\"a\":[1,2]}'::jsonb)",
    'ON CONFLICT (passage_id) DO NOTHING;',
    'INSERT INTO public.challenge_passages (passage_id, lang, band, title_en, title_ur, calib) VALUES',
    "  ('ur.read.1.y', 'ur', 1, NULL, 'لال پتنگ', NULL),",
    "  ('ur.read.1.z', 'ur', 2, NULL, NULL, NULL)",
    'ON CONFLICT (passage_id) DO NOTHING;',
    "UPDATE public.challenge_passages SET title_en = 'Other' WHERE passage_id = 'en.read.1.x';",
  ].join('\n');

  test('every INSERT row, quotes unescaped, NULL as null, a cast ignored', () => {
    expect(L.seedTitles(sql)).toEqual({
      'en.read.1.x': { title_en: "Imran's Kite", title_ur: null },
      'ur.read.1.y': { title_en: null, title_ur: 'لال پتنگ' },
      'ur.read.1.z': { title_en: null, title_ur: null },
    });
  });

  test('a seeded-bad copy: a stale title, a title the file lacks, and a passage with no file are named', () => {
    const files = {
      'en.read.1.x': { title_en: 'Imran and the Kite', title_ur: null },
      'ur.read.1.y': { title_en: 'Red Kite', title_ur: 'لال پتنگ' },
    };
    expect(L.titleMismatches(L.seedTitles(sql), files)).toEqual([
      'en.read.1.x title_en: seed "Imran\'s Kite" != file "Imran and the Kite"',
      'ur.read.1.y title_en: seed null != file "Red Kite"',
      'ur.read.1.z: in the seed, no passage file',
    ]);
  });

  test('equal titles, and NULL on both sides, pass', () => {
    expect(L.titleMismatches(L.seedTitles(sql), {
      'en.read.1.x': { title_en: "Imran's Kite", title_ur: null },
      'ur.read.1.y': { title_en: null, title_ur: 'لال پتنگ' },
      'ur.read.1.z': { title_en: null, title_ur: null },
    })).toEqual([]);
  });
});

describe('the committed seed and the passage files', () => {
  test('every seeded passage carries its file\'s titles', () => {
    const seed = L.seedTitles(fs.readFileSync(L.STOCK_SEED, 'utf8'));
    expect(Object.keys(seed).length).toBeGreaterThan(20);
    expect(L.titleMismatches(seed, L.passageTitles())).toEqual([]);
  });
});
