/**
 * NIETE and PK production share ONE R2 bucket, with byte-identical credentials. The `lp612/`
 * prefix is the ONLY isolation there is — there is no separate bucket, no separate account, and
 * nothing at the storage layer that would stop a wrong key landing on top of a PK production
 * asset.
 *
 * The page-truth uploader has refused to write outside its prefix since day one, and its comment
 * says why: "enforced immediately before every put, not merely at plan time, so that no future
 * caller can construct a key some other way and skip it."
 *
 * The serving path WAS that future caller. It uploads the rendered PDF, and now the authored
 * document beside it, and neither went through any guard — the keys happened to be right because
 * `r2KeyFor` builds them, which is a convention rather than an enforcement.
 *
 * So the guard moves next to the key builder, where key SHAPE and key SAFETY are decided in one
 * place, and both uploads go through it.
 */

jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(), sendDocumentByLink: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({ getPresignedUrl: jest.fn(), buildR2PublicUrl: jest.fn() }));
jest.mock('../../bot/shared/services/lp612-catalog.service', () => ({ segmentById: jest.fn() }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { assertKeyInPrefix, r2KeyFor } = require('../../bot/shared/services/lp612-serving.service');

describe('nothing this lane writes may leave the lp612/ prefix', () => {
  test('a key the lane actually builds is allowed through unchanged', () => {
    const k = r2KeyFor('grade_9_chemistry.c01.p007-008', 'en', 'v9.1');
    expect(assertKeyInPrefix(k)).toBe(k);
    expect(assertKeyInPrefix(k.replace(/\.pdf$/, '.lp.json'))).toContain('lp612/');
  });

  test.each([
    ['a PK production LP cache', 'pre_gen_lps/grade_9/chem.pdf'],
    ['the live lesson_plans tree', 'lesson_plans/abc.pdf'],
    ['the K-5 v8 cache', 'lp-cache/v8/x.pdf'],
    ['coaching audio', 'audio/session-1.ogg'],
    ['the bucket root', 'something.pdf'],
  ])('refuses to write over %s', (_label, key) => {
    expect(() => assertKeyInPrefix(key)).toThrow(/lp612\//);
  });

  test('refuses a traversal that merely STARTS inside the prefix', () => {
    // 'lp612/../pre_gen_lps/x.pdf' passes a naive startsWith and lands on PK production.
    expect(() => assertKeyInPrefix('lp612/../pre_gen_lps/x.pdf')).toThrow(/traversal/i);
  });

  test('refuses an empty or missing key rather than writing to a blank one', () => {
    expect(() => assertKeyInPrefix('')).toThrow();
    expect(() => assertKeyInPrefix(null)).toThrow();
  });

  test('a near-miss prefix is NOT accepted', () => {
    // `lp612x/` starts with the same letters and is a different tree.
    expect(() => assertKeyInPrefix('lp612x/v9.1/en/a.pdf')).toThrow();
  });
});
