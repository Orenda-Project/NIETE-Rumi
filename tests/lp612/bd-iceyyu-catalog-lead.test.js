'use strict';
/**
 * bd-iceyyu — buildSegmentItems keeps room for the "Make my own" row (lead: 1) without ever passing Meta's 20-row
 * NavigationList cap, and without moving a lesson out of reach. The product reviewer asked for the 19/20/21 boundaries.
 *
 * lead 0 (every flag-off teacher) is today's paging exactly: 19 lessons + More per page.
 * lead 1: page 1 shows 18 lessons (+ More) so the row fits; page 2 starts at lesson 19, and the More row carries
 * lead '1' so page 2 knows where page 1 stopped.
 */

let mockRows = [];
function mockBuilder() {
  const b = {
    select: () => b, eq: () => b, in: () => b, or: () => b, order: () => b, limit: () => b,
    range: (from, to) => ({ then: (res, rej) => Promise.resolve({ data: mockRows.slice(from, to + 1), error: null }).then(res, rej) }),
    then: (res, rej) => Promise.resolve({ data: mockRows, error: null }).then(res, rej),
  };
  return b;
}
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn(() => mockBuilder()) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const Catalog = require('../../bot/shared/services/lp612-catalog.service');

const rows = (n, language = 'en') => Array.from({ length: n }, (_, i) => ({
  segment_id: `s${i + 1}`, menu_title: `Lesson ${i + 1}`, subtopic_title: '', printed_page_start: i + 1,
  printed_page_end: i + 1, order_index: i + 1, lp_type: 'content', language, yt: null,
}));
const ids = (items) => items.filter((it) => /^s\d+$/.test(it.id)).map((it) => it.id);
const more = (items) => items.find((it) => !/^s\d+$/.test(it.id));
const build = (page, lead) => Catalog.buildSegmentItems(7, 'Physics', 'c01', page, 'g7_physics', lead ? { lead } : undefined);

describe.each([18, 19, 20, 21, 37])('a chapter of %i lessons', (n) => {
  beforeEach(() => { mockRows = rows(n); });

  test('lead 1: page 1 + the row stays inside 20, and every lesson is reachable exactly once', async () => {
    const seen = [];
    let page = 1;
    for (;;) {
      const r = await build(page, 1);
      const room = page === 1 ? 1 : 0;
      expect(r.items.length + room).toBeLessThanOrEqual(20);
      seen.push(...ids(r.items));
      const m = more(r.items);
      if (!m) break;
      expect(m['on-click-action'].payload.lead).toBe('1');
      page = Number(m['on-click-action'].payload.page);
    }
    expect(seen).toEqual(mockRows.map((x) => x.segment_id));
  });

  test('lead 0: exactly today\'s paging (19 a page), and the More row carries no lead', async () => {
    const r = await build(1, 0);
    expect(ids(r.items)).toEqual(mockRows.slice(0, 19).map((x) => x.segment_id));
    const m = more(r.items);
    if (m) expect(m['on-click-action'].payload).not.toHaveProperty('lead');
  });
});

test('rtl comes back for an Urdu book, so the row speaks the book\'s language', async () => {
  mockRows = rows(3, 'ur');
  expect((await build(1, 1)).rtl).toBe(true);
  mockRows = rows(3, 'en');
  expect((await build(1, 1)).rtl).toBe(false);
});
