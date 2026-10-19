'use strict';
/**
 * bd-v0toag.9 / .10 — the teacher report page's v21 pieces. They render only when the data
 * layer supplied them (which it does only with quiz_slo_retest_enabled on): a "Completed" tile
 * beside Average, an "N tries" tag on a child who played more than once, and the curriculum
 * SLO code on a question. Strings in en + ur.
 */
const Frag = require('../../../shared/templates/teacher-report-v21.parts');
const { renderPage } = require('../../../shared/templates/teacher-report.page');

const base = (extra = {}) => ({
  quiz: { id: 'q1', topic: 'Plants', subject: 'science', grade: '3', source: 'lp_v8', language: 'en', date: '2026-10-12T05:00:00Z', code: 'AB12CD', link: null },
  roster: { state: 'none', className: null, of: null, lists: [] },
  summary: { played: 2, onList: null, of: null, avg: 63, total: 2, hardestN: 2 },
  played: [{ first: 'Amna', roll: null, onList: false, correct: 2, total: 2, pct: 100 }, { first: 'Bilal', roll: null, onList: false, correct: 1, total: 2, pct: 50 }],
  notPlayed: null, provisional: [], questions: [{ n: 1, text: 'Q1?', answered: 2, correctPct: 50, wrongTop: null }],
  guidance: null, reminder: null, ...extra,
});
const html = (r, lang = 'en') => renderPage({ quiz: r }, { lang });

describe('fragments', () => {
  test('completion tile in en and ur', () => {
    expect(Frag.completionTile({ started: 3, finished: 2, pct: 67 }, 'en')).toContain('Completed');
    expect(Frag.completionTile({ started: 3, finished: 2, pct: 67 }, 'en')).toContain('2/3');
    expect(Frag.completionTile({ started: 3, finished: 2, pct: 67 }, 'ur')).toContain('مکمل کیا');
    expect(Frag.completionTile(null, 'en')).toBe('');
  });
  test('tries tag only above one try', () => {
    expect(Frag.triesTag(1, 'en')).toBe('');
    expect(Frag.triesTag(undefined, 'en')).toBe('');
    expect(Frag.triesTag(3, 'en')).toContain('3</span> tries');
    expect(Frag.triesTag(3, 'ur')).toContain('بار');
  });
  test('code chip escapes and is empty without a code', () => {
    expect(Frag.codeChip(null)).toBe('');
    expect(Frag.codeChip('M-02-<b>')).toContain('M-02-&lt;b&gt;');
  });
});

describe('the page', () => {
  test('without v21 data the page has none of it, and keeps its three tiles', () => {
    const h = html(base());
    expect(h).not.toContain('tile-done');
    expect(h).not.toContain('class="tries');
    expect(h).not.toContain('class="slo');
    expect(h).toContain('<div class="tiles">');
    expect(h).not.toContain(Frag.CSS); // switch off = byte-identical page, so no v21 CSS either
  });
  test('the v21 CSS rides along only when a v21 piece rendered', () => {
    expect(html(base({ questions: [{ ...base().questions[0], code: 'S-03-PL-01' }] }))).toContain(Frag.CSS);
    expect(Frag.usedIn('<div class="tiles">')).toBe(false);
    expect(Frag.usedIn('<span class="slo" dir="ltr">X</span>')).toBe(true);
    expect(Frag.usedIn('<span class="tries tag">2</span>')).toBe(true);
    expect(Frag.usedIn('<div class="tiles tiles-4">')).toBe(true);
  });
  test('with v21 data: a fourth tile, a tries tag and the SLO code', () => {
    const r = base({
      summary: { ...base().summary, completion: { started: 3, finished: 2, pct: 67 } },
      played: [{ ...base().played[0], attempts: 2 }, { ...base().played[1], attempts: 1 }],
      questions: [{ ...base().questions[0], code: 'S-03-PL-01' }],
    });
    const h = html(r);
    expect(h).toContain('<div class="tiles tiles-4">');
    expect(h).toContain('tile-done');
    expect((h.match(/class="tries/g) || []).length).toBe(1);
    expect(h).toContain('S-03-PL-01');
    expect(html(r, 'ur')).toContain('مکمل کیا');
  });
});
