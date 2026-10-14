/**
 * v10 coaching test (bd-v0toag.50.1): `--kind card` uploads the v10 cards beside the v9 lesson.
 *
 * A card row is its own asset kind (migration V1.6.6), so loading cards never supersedes the current
 * lesson: every teacher keeps v9 and only plan-arm v10 schools are sent the card. The card PDF gets
 * its own R2 key, so it can never overwrite a lesson object, and answer keys are not carried along.
 */
const U = require('../../scripts/upload-lp-v8-to-r2');

const ID = 'grade_1_english_ch4_seg2';
const line = JSON.stringify({
  id: ID, files: { pdf: 'out/v10/card.pdf', answer_key_pdf: 'out/v10/key.pdf' },
  pdf_sha1: 'abc123', version_stamp: 'v10card_14Oct',
});
const known = new Set([ID]);

describe('--kind card', () => {
  test('each manifest PDF becomes one card item, no answer key', () => {
    const items = U.parseManifest(line, known, { kind: 'card' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ lesson_id: ID, asset_kind: 'card', pdf_path: 'out/v10/card.pdf', version_stamp: 'v10card_14Oct' });
  });

  test('without --kind card nothing is a card (today unchanged)', () => {
    expect(U.parseManifest(line, known).map((i) => i.asset_kind)).toEqual(['lesson', 'answer_key']);
  });

  test('the card has its own R2 key beside the lesson', () => {
    expect(U.r2KeyFor(ID, 'a1b2c3d4e5f6', 'card')).toBe(`lp-cache/v8/${ID}/a1b2c3d4e5f6.card.pdf`);
  });

  test('a new card never supersedes the current v9 lesson', () => {
    const [item] = U.parseManifest(line, known, { kind: 'card' });
    const v9 = { id: 'v9', lesson_id: ID, asset_kind: 'lesson', content_hash: 'ffffffffffff', is_current: true };
    const plan = U.planFor(item, 'a1b2c3d4e5f6', [v9]);
    expect(plan.supersede).toEqual([]);
    expect(plan.upload).toBe(true);
  });

  test('a newer card supersedes only the older card', () => {
    const [item] = U.parseManifest(line, known, { kind: 'card' });
    const v9 = { id: 'v9', lesson_id: ID, asset_kind: 'lesson', content_hash: 'ffffffffffff', is_current: true };
    const old = { id: 'c1', lesson_id: ID, asset_kind: 'card', content_hash: 'eeeeeeeeeeee', is_current: true };
    const ids = U.planFor(item, 'a1b2c3d4e5f6', [v9, old]).supersede.map((r) => (r && r.id) || r);
    expect(ids).toEqual(['c1']);
  });
});
