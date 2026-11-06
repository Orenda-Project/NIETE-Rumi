'use strict';
/**
 * bd-rj6w0n.14.5 / bd-rj6w0n.14.16 — the GB K-5 subject screen.
 *
 * GB plans are written on request (bd-rj6w0n.14.16), so a book opens as soon as its lessons are in the
 * catalogue: no ready render is needed, and ICT's render table is never read. Only the four on-request
 * subjects (English, Urdu, Maths, Science) are offered; a grade's other books (GK, SST, Islamiat…) are
 * not listed at all. An on-request book with no lessons in the catalogue yet is Coming Soon and its tap
 * is refused.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => { throw new Error('the shelf reads no table'); }) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Shelf = require('../../bot/shared/services/lp612-gb-shelf.service');

const item = (subject) => ({
  id: subject,
  'main-content': { title: subject, description: '3 chapters', metadata: 'Grade 4 · 20 lessons' },
  'on-click-action': { name: 'data_exchange', payload: { step: 'lp612_subject', grade: '4', subject } },
});
const GB_EN = { curriculum: 'nbf_snc', language: 'en' };

describe('gbShelfItems', () => {
  const build = jest.fn();
  const deps = { buildSubjectItems: build };
  beforeEach(() => { build.mockReset(); });

  test('only the four on-request subjects, in order; a book with lessons opens with its normal row', async () => {
    build.mockResolvedValue([item('English'), item('Math'), item('Science'), item('Islamiat'), item('Social Studies')]);
    const rows = await Shelf.gbShelfItems(4, GB_EN, deps);
    expect(rows.map((r) => r['main-content'].title)).toEqual(['English', 'Urdu', 'Math', 'Science']);
    expect(rows[0]).toEqual(item('English'));
    expect(rows[2]).toEqual(item('Math'));
    expect(rows[3]).toEqual(item('Science'));
    expect(build).toHaveBeenCalledWith(4, GB_EN);
  });

  test('an on-request book with no lessons yet is Coming Soon and cannot be opened', async () => {
    build.mockResolvedValue([item('English')]);
    const rows = await Shelf.gbShelfItems(4, GB_EN, deps);
    const urdu = rows.find((r) => r['main-content'].title === 'Urdu');
    expect(urdu['main-content'].description).toBe('Coming Soon');
    expect(urdu['on-click-action'].payload.step).toBe('lp612_gb_soon');
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  test('GK, SST and Islamiat are never offered, not even as Coming Soon (Grade 1: no Science either)', async () => {
    build.mockResolvedValue([item('GK'), item('Islamiat')]);
    const rows = await Shelf.gbShelfItems(1, GB_EN, deps);
    expect(rows.map((r) => r['main-content'].title)).toEqual(['English', 'Urdu', 'Mathematics']);
    expect(rows.every((r) => r['main-content'].description === 'Coming Soon')).toBe(true);
  });

  test('an Urdu teacher reads the Coming Soon label in Urdu, within the 20-code-point cap', async () => {
    build.mockResolvedValue([]);
    const rows = await Shelf.gbShelfItems(2, { curriculum: 'nbf_snc', language: 'ur' }, deps);
    const desc = rows[0]['main-content'].description;
    expect(desc).toBe('جلد آ رہا ہے');
    expect([...desc].length).toBeLessThanOrEqual(20);
  });
});

describe('refuseComingSoon', () => {
  test('a tap on a Coming Soon row is refused in the teacher\'s language', () => {
    expect(Shelf.refuseComingSoon('en').data.error.message).toMatch(/coming soon/i);
    expect(Shelf.refuseComingSoon('ur').data.error.message).toMatch(/[؀-ۿ]/);
  });
});
