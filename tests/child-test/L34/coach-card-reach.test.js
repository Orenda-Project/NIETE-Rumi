'use strict';
/**
 * L34 (bd-s1oo0.47, CONTRACT §20) — the coach card prints, under each gated question, the same condition as
 * the step message and the anchor words (the end of the line the answer needs), in small type. Question 1
 * carries none when its needs_line is 1. HTML level; the real Chromium fit is L29's real-render test.
 */
const v2 = require('../../../bot/shared/services/child-test/render/v2');
const bankJson = require('../../../bot/shared/data/child-test/item-bank.v1.json');
const { anchorFor } = require('../../../bot/shared/services/child-test/scoring/reach');

const html = (grade, set = 'A') => v2.buildCoachCardHtml({ grade, set, form: bankJson.grades[String(grade)].forms[set] });
const reachRows = (h) => [...h.matchAll(/<span class="reach(?: onp)?" data-reach="([^"]+)">([\s\S]*?)<\/span>/g)].map((m) => ({ id: m[1], inner: m[2] }));

describe('coach card: a reach note under each gated question', () => {
  test.each([[3, 'A'], [3, 'B'], [5, 'A'], [5, 'B']])('G%s Set %s: one note per gated question, with its anchor', (grade, set) => {
    const h = html(grade, set);
    const form = bankJson.grades[String(grade)].forms[set];
    const gated = [];
    for (const block of ['urdu', 'english']) {
      form[block].questions.forEach((q, i) => { if (i > 0 || q.needs_line > 1) gated.push({ q, anchor: anchorFor(form[block], q) }); });
    }
    const rows = reachRows(h);
    expect(rows.map((r) => r.id)).toEqual(gated.map((g) => g.q.id));
    for (const { q, anchor } of gated) {
      const r = rows.find((x) => x.id === q.id);
      expect(r.inner).toContain(anchor);
    }
  });

  test('G3A: Urdu note in Urdu with «», English note in English with “”', () => {
    const rows = reachRows(html(3));
    const u2 = rows.find((r) => r.id === 'u3A-q2');
    expect(u2.inner).toContain('صرف اگر بچہ یہ الفاظ پڑھ چکا ہو:');
    expect(u2.inner).toContain('«حرکت کرتے دیکھا»');
    const e1 = rows.find((r) => r.id === 'e3A-q1');
    expect(e1.inner).toContain('Only if the child read past:');
    expect(e1.inner).toContain('“was planting trees”');
    expect(rows.find((r) => r.id === 'u3A-q1')).toBeUndefined();
  });
});
