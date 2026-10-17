'use strict';
/**
 * bd-s42dye.4 — the legacy "Taleemabad" import re-hosts only the media that cannot be rendered, to a key that is
 * the same in every environment, and refuses to run against the wrong database.
 *
 * Staging and prod share ONE R2 bucket (digital-coach-audio): a key built from the target's module row id would
 * let a staging run overwrite a prod object that happens to have the same id. The fde module id is the same
 * everywhere, so the same file lands at the same key and a second environment finds it already there.
 */
const rules = require('../../scripts/lib/legacy-media-rehost.rules');

describe('needsRehost (the 30 binary/octet-stream files, not the 395 that already play)', () => {
  test.each([
    ['binary/octet-stream', true],
    ['application/octet-stream', true],
    ['BINARY/OCTET-STREAM; charset=x', true],
    ['', true],
    [undefined, true],
    ['video/mp4', false],
    ['application/pdf', false],
    ['video/webm', false],
  ])('%s -> %s', (ct, want) => {
    expect(rules.needsRehost(ct)).toBe(want);
  });
});

describe('legacyRehostKey', () => {
  test('is keyed by the fde module id, identical across environments', () => {
    expect(rules.legacyRehostKey(819, 'mp4')).toBe('training/rehosted-legacy/819/asset.mp4');
    expect(rules.legacyRehostKey(5, 'pdf')).toBe('training/rehosted-legacy/5/asset.pdf');
  });
  test('never collides with the bd-2666 keys, which use the target row id', () => {
    expect(rules.legacyRehostKey(10, 'mp4').startsWith('training/rehosted/')).toBe(false);
  });
});

describe('assertTarget', () => {
  const URL_OF = (ref) => `https://${ref}.supabase.co`;
  test('accepts the matching project for each target', () => {
    expect(rules.assertTarget('sandbox', URL_OF('olvritwoqujtjvwfulbh'))).toBe('olvritwoqujtjvwfulbh');
    expect(rules.assertTarget('staging', URL_OF('rpqkekcfvumypldbejhp'))).toBe('rpqkekcfvumypldbejhp');
    expect(rules.assertTarget('prod', URL_OF('ihzciabopbttygxxgrkm'))).toBe('ihzciabopbttygxxgrkm');
  });
  test('aborts when the env points at another project (the seeded-worktree trap)', () => {
    expect(() => rules.assertTarget('sandbox', URL_OF('ihzciabopbttygxxgrkm'))).toThrow(/ABORT/);
    expect(() => rules.assertTarget('prod', URL_OF('olvritwoqujtjvwfulbh'))).toThrow(/ABORT/);
  });
  test('aborts on an unknown target or an unparseable url', () => {
    expect(() => rules.assertTarget('nope', URL_OF('olvritwoqujtjvwfulbh'))).toThrow(/ABORT/);
    expect(() => rules.assertTarget('prod', 'not a url')).toThrow(/Unrecognized/);
  });
});
