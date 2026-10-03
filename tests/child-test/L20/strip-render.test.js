/**
 * L20 (bd-s1oo0.38) — the printed maths strip carries the child's number for today's visit, not the
 * roll. Rolls renumber monthly and 3.4% of children have none (CONTRACT §18); the child number is the
 * child's place on today's list (1–5, alternates after), so the coach writes one or two digits.
 * Runs the real builder; the browser half is the rendered PNG in the lane folder.
 */
const bank = require('../L2/fixtures/item-bank.fixture.json');
const html = require('../../../bot/shared/services/child-test/render/html');

const visible = (s) => s.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('the strip box is "بچہ نمبر / Child no."', () => {
  for (const [g, f] of [[3, 'A'], [5, 'B']]) {
    const out = html.buildPrintableHtml({ grade: g, formCode: f, form: bank.grades[String(g)].forms[f] });
    const strip = out.split('<section class="page').slice(1).find((p) => /data-page="maths-strip"/.test(p));

    test(`G${g}-${f}: labelled in Urdu and English, no roll number anywhere on the strip`, () => {
      const text = visible(strip);
      expect(text).toContain('بچہ نمبر');
      expect(text).toContain('Child no.');
      expect(text).not.toMatch(/Roll no\.|رول نمبر/);
      expect(strip).not.toMatch(/data-field="roll"/);
    });

    test(`G${g}-${f}: two digit cells, one field the vision step can find`, () => {
      expect(strip).toMatch(/data-field="child-no"/);
      expect((strip.match(/class="digit"/g) || []).length).toBe(2);
    });

    test(`G${g}-${f}: corner code, fiducials and the sums are unchanged`, () => {
      expect(visible(strip)).toContain(html.formCode(g, f));
      expect((strip.match(/class="fid /g) || []).length).toBe(4);
    });
  }
});
