'use strict';

/**
 * RULING W3-12 on the Wave 2 coach passages too (ur.story, en.story and their questions, every rotation variant): each
 * sentence starts a new line, as the official pages print it, so the Whole battery and the RDF auto / manual forms
 * draw the same passage the same way. A word's line is the sentence it sits in, counted on that variant's own printed
 * text; passage.print_lines holds one entry per sentence; a question's needs_line is the sentence holding the end of
 * the line it asked for; EGRA's early stop is on the first sentence.
 */

const path = require('path');
const fs = require('fs');
const { passageTokens } = require('../../shared/services/child-test/sa/build-w3');

const SA = path.join(__dirname, '../../shared/data/child-test/sa');
const runtime = (form, lang) => JSON.parse(fs.readFileSync(path.join(SA, `sa.${form}.${lang}.json`), 'utf8'));
const COACH_FORMS = ['coach.G3.A', 'coach.G5.A'];
const END = /[.!?۔؟]["”’)]*$/u;

describe('Wave 2 passages: one sentence per line on every variant', () => {
  for (const form of COACH_FORMS) for (const lang of ['ur', 'en']) {
    test(`${form} ${lang}.story: line = sentence number, contiguous 1..N, N = print_lines; stop on the first sentence`, () => {
      const story = runtime(form, lang).tasks.find((x) => x.id === `${lang}.story`);
      const vs = [story, ...(story.variants || [])];
      expect(vs.length).toBeGreaterThanOrEqual(2);
      for (const v of vs) {
        const tokens = passageTokens(v.passage.text);
        expect([v.id, tokens.length]).toEqual([v.id, v.items.length]);
        let n = 1;
        const want = tokens.map((w, i) => { const at = n; if (END.test(w) && i < tokens.length - 1) n += 1; return at; });
        expect([v.id, v.items.map((w) => w.line)]).toEqual([v.id, want]);
        expect([v.id, [...new Set(want)]]).toEqual([v.id, Array.from({ length: n }, (_, i) => i + 1)]);
        expect([v.id, (v.passage.print_lines || []).length]).toEqual([v.id, n]);
        expect(v.passage.print_lines.join(' ')).toBe(tokens.join(' '));
        expect(v.passage.lines.map((l) => [l.n, l.from, l.to])).toEqual([...new Set(want)].map((k) => [k, want.indexOf(k), want.lastIndexOf(k)]));
        expect([v.id, v.stop.first_line_n]).toEqual([v.id, want.filter((k) => k === 1).length]);
      }
    });

    test(`${form} ${lang}: the Whole battery and the W3 forms agree on every shared variant's lines and questions' reach`, () => {
      const b = runtime(form, lang);
      const byId = (id) => b.tasks.find((x) => x.id === id);
      const w2 = byId(`${lang}.story`), w3 = byId(`${lang}.story_w3`);
      const c2 = byId(`${lang}.story_comp`), c3 = byId(`${lang}.story_comp_w3`);
      const shared = (w3.variants || [w3]).map((v) => v.id || 'own');
      for (const id of shared) {
        const v2 = (w2.variants || []).find((v) => v.id === id) || w2;
        const v3 = (w3.variants || []).find((v) => v.id === id) || w3;
        expect([id, v2.items.map((w) => w.line)]).toEqual([id, v3.items.map((w) => w.line)]);
        expect([id, v2.passage.print_lines]).toEqual([id, v3.passage.print_lines]);
        const q2 = ((c2.variants || []).find((v) => v.id === id) || c2).items;
        const q3 = ((c3.variants || []).find((v) => v.id === id) || c3).items;
        const reach = (qs) => qs.map((q) => [q.id.replace(/^(ur|en)\.story_w3\./, '$1.story.'), q.needs_line]);
        expect([id, reach(q2).filter(([qid]) => reach(q3).some(([x]) => x === qid))]).toEqual([id, reach(q3).filter(([qid]) => reach(q2).some(([x]) => x === qid))]);
      }
    });
  }

  test('UR SELECT 2024 in the Whole battery: 8 sentence lines; its questions need sentences 1/3/4/5/8', () => {
    for (const form of COACH_FORMS) {
      const b = runtime(form, 'ur');
      const sel = b.tasks.find((x) => x.id === 'ur.story').variants.find((v) => v.id === 'select2024');
      expect(Math.max(...sel.items.map((w) => w.line))).toBe(8);
      const q = b.tasks.find((x) => x.id === 'ur.story_comp').variants.find((v) => v.id === 'select2024').items;
      expect(q.map((x) => x.needs_line)).toEqual([1, 3, 4, 5, 8]);
    }
  });
});
