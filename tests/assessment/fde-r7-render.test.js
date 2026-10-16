/**
 * What the seventh review round asked of the board-pattern renderer and the
 * layout pass, each through the real chain (applyLayout → normaliseScheme →
 * renderPaper / renderMarkingScheme, or a stored paper straight into the
 * renderer):
 *
 *   1. Review markers are two lists. Our own chrome (header, notes, legend,
 *      the before-the-exam box) is refused for every marker; the model's item
 *      text only for the English ones, ⚠ and "MODEL PAPER FOR", so correct
 *      Urdu («اسی طرح» in an instruction, «مسودہ» in a distractor) prints.
 *      The error says which list it hit.
 *   2. A page list that is exactly whole units of the pattern prints the units
 *      («Covers Unit 8»), not the page numbers.
 *   3. Rows the scheme pass filled in code are counted in the before-the-exam box.
 *
 * Pure: HTML strings, no browser. The two stored papers are sandbox
 * generations with no person in them; the rest is fictional.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027').subjects;
const clone = (o) => JSON.parse(JSON.stringify(o));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
}

function visible(html) {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[‎‏⁦-⁩]/g, '')
    .replace(/\s+/g, ' ');
}

const paperOf = (exam, subject) => R.renderPaper({ examJson: exam, grade: 5, subject, answerLines: true });
const schemeOf = (exam, subject) => R.renderMarkingScheme({ examJson: exam, grade: 5, subject });

function thrown(fn) {
  try { fn(); } catch (err) { return err; }
  return null;
}

// Every item the model wrote, in tree order.
function itemsOf(exam) {
  const out = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(exam[branch] || {})) {
      for (const list of Object.values(types || {})) if (Array.isArray(list)) out.push(...list);
    }
  }
  return out;
}

describe('1. review markers: chrome refuses every marker, item text only the English ones', () => {
  test('real Urdu item text renders', () => {
    const urdu = fixture('r7-urdu-item-text');
    const sst = fixture('r7-sst-item-text');
    // The stored papers carry the words the old single list refused.
    expect(JSON.stringify(itemsOf(urdu))).toContain('اسی طرح');
    expect(JSON.stringify(itemsOf(sst))).toContain('مسودہ');

    // The comprehension part carrying it prints FDE's own instruction, so the
    // proof is that the paper renders at all (it threw REVIEW_TEXT before).
    expect(() => paperOf(clone(urdu), 'urdu')).not.toThrow();
    expect(() => schemeOf(clone(urdu), 'urdu')).not.toThrow();

    const sstPaper = paperOf(clone(sst), 'social_studies');
    expect(visible(sstPaper)).toContain('مسودہ');
    expect(() => schemeOf(clone(sst), 'social_studies')).not.toThrow();
  });

  test('chrome marker still refused', () => {
    const places = [
      (L) => { L.header.note_ur = `${L.header.note_ur} اسی طرح`; },
      (L) => { L.before_exam.lines_ur[3] = `${L.before_exam.lines_ur[3]} اسی طرح`; },
      (L) => { L.legend.lines_ur = [...(L.legend.lines_ur || []), 'مسودہ']; },
      (L) => { L.notes = [{ slot: 'urdu.A.Q1', index: 0, model: 'اسی طرح' }]; },
      (L) => { L.header.title_ur = `${L.header.title_ur} ⚠`; },
    ];
    for (const put of places) {
      const exam = clone(fixture('r7-urdu-item-text'));
      put(exam._layout);
      for (const render of [paperOf, schemeOf]) {
        const err = thrown(() => render(clone(exam), 'urdu'));
        expect(err && err.code).toBe('REVIEW_TEXT');
        expect(err.list).toBe('chrome');
        expect(err.message).toMatch(/^REVIEW_TEXT\[chrome\]/);
      }
    }
  });

  test('english marker in item text refused', () => {
    for (const bad of ['needs review', 'Needs Review', 'filler', '⚠', 'MODEL PAPER FOR', 'Islamabad Model School']) {
      const exam = clone(fixture('r7-sst-item-text'));
      const q = itemsOf(exam).find((x) => typeof x.question === 'string');
      q.question = `${q.question} ${bad}`;
      for (const render of [paperOf, schemeOf]) {
        const err = thrown(() => render(clone(exam), 'social_studies'));
        expect({ bad, code: err && err.code }).toEqual({ bad, code: 'REVIEW_TEXT' });
        expect(err.list).toBe('item');
        expect(err.message).toMatch(/^REVIEW_TEXT\[item\]/);
      }
    }
  });

  test('the item list is exported for the re-ask, English markers only', () => {
    expect(R.REFUSED_ITEM.every((re) => re instanceof RegExp)).toBe(true);
    const hits = (t) => R.REFUSED_ITEM.some((re) => re.test(t));
    for (const bad of ['needs review', 'filler', '⚠', 'MODEL PAPER FOR', 'Islamabad Model School']) expect({ bad, hit: hits(bad) }).toEqual({ bad, hit: true });
    for (const ok of ['اسی طرح', 'مسودہ']) expect({ ok, hit: hits(ok) }).toEqual({ ok, hit: false });
  });

  test('Urdu markers anywhere in item text (options, answers, scheme points) render', () => {
    const exam = clone(fixture('r7-sst-item-text'));
    const q = itemsOf(exam).find((x) => Array.isArray(x.options));
    q.question = `${q.question} اسی طرح`;
    expect(() => paperOf(clone(exam), 'social_studies')).not.toThrow();
    expect(() => schemeOf(clone(exam), 'social_studies')).not.toThrow();
  });
});

describe('2. a page list that is whole units prints the units', () => {
  const scopeOf = (subject, pages) => applyLayout({ unseen: {} }, P[subject], { kind: 'pages', chapters: null, pages }, { now: NOW }).examJson._layout.scope;

  test('pages equal to one unit print the unit', () => {
    // The app's "Unit 8" sends pp 171–180, exactly the pattern's Unit 8.
    const s = scopeOf('maths', '171-180');
    expect(s.covers_en).toBe('Covers Unit 8; every section set from these pages.');
    expect(s.covers_ur).toBe('احاطہ: باب 8؛ ہر حصہ انہی صفحات سے۔');
    expect(s.pages).toBe('171-180');
    expect(s.kind).toBe('pages');
  });

  test('pages equal to two units print the range', () => {
    // The round-2 Maths chapter papers: Units 1–2 and Units 11–12 as page lists.
    expect(scopeOf('maths', '1-12, 14-40').covers_en).toBe('Covers Units 1–2; every section set from these pages.');
    expect(scopeOf('maths', '1-12, 14-40').covers_ur).toBe('احاطہ: ابواب 1–2؛ ہر حصہ انہی صفحات سے۔');
    expect(scopeOf('maths', '218-226, 239-244, 254-257, 267-271').covers_en).toBe('Covers Units 11–12; every section set from these pages.');
    // Order and an en dash do not matter; two units apart keep the comma.
    expect(scopeOf('maths', '14–40,1-12').covers_en).toBe('Covers Units 1–2; every section set from these pages.');
    expect(scopeOf('maths', '1-12, 171-180').covers_en).toBe('Covers Units 1, 8; every section set from these pages.');
  });

  test('a partial unit keeps pp', () => {
    expect(scopeOf('maths', '171-179').covers_en).toBe('Covers pp 171-179; every section set from these pages.');
    expect(scopeOf('maths', '171-181').covers_en).toBe('Covers pp 171-181; every section set from these pages.');
    expect(scopeOf('maths', '1-40').covers_en).toBe('Covers pp 1-40; every section set from these pages.');
    expect(scopeOf('maths', '1-12, 14-30').covers_ur).toBe('احاطہ: ص 1-12, 14-30؛ ہر حصہ انہی صفحات سے۔');
    // A subject whose pattern lists no unit pages keeps the page form.
    expect(scopeOf('science', '1-12').covers_en).toBe('Covers pp 1-12; every section set from these pages.');
  });

  test('the scheme prints the unit line, in both languages', () => {
    const raw = fixture('maths');
    const exam = normaliseScheme(applyLayout(raw, P.maths, { kind: 'pages', chapters: null, pages: '171-180' }, { now: NOW }).examJson).examJson;
    const html = R.renderMarkingScheme({ examJson: exam, grade: 5, subject: 'maths', allowShort: true });
    expect(visible(html)).toContain('Covers Unit 8; every section set from these pages.');
    const ur = clone(exam);
    ur._layout.medium = 'ur';
    const urHtml = R.renderMarkingScheme({ examJson: ur, grade: 5, subject: 'maths', allowShort: true });
    // Urdu digits, no «·» beside them.
    expect(visible(urHtml).replace(/ ؛/g, '؛')).toContain('احاطہ: باب ۸؛ ہر حصہ انہی صفحات سے۔');
    expect(visible(urHtml)).not.toMatch(/·\s*[۰-۹]|[۰-۹]\s*·/);
  });
});

describe('3. rows filled by code are counted in the before-the-exam box', () => {
  const box = (html) => {
    const at = html.indexOf('<div class="box before">');
    return visible(html.slice(at, html.indexOf('</ol>', at)));
  };

  function sst(shortfall, medium = 'en') {
    const exam = clone(fixture('r7-sst-item-text'));
    exam._layout.medium = medium;
    if (shortfall !== undefined) exam._layout.scheme_shortfall = shortfall;
    return exam;
  }

  test('no shortfall key: the box is exactly as before', () => {
    const before = box(schemeOf(sst(undefined), 'social_studies'));
    expect(before).not.toMatch(/written from the answer/);
    expect(box(schemeOf(sst([]), 'social_studies'))).toBe(before);
  });

  test('one row filled by code', () => {
    const slot = 'social_studies.A.Q1';
    const html = schemeOf(sst([{ slot, item: 0, part: null, filled_by: 'code' }]), 'social_studies');
    expect(box(html)).toContain('1 marking row was written from the answer. Check it before marking.');
    expect(box(html)).not.toContain('rows were written');
  });

  test('two rows, and a removed item is not counted', () => {
    const exam = sst([
      { slot: 'social_studies.A.Q1', item: 0, part: null, filled_by: 'code' },
      { slot: 'social_studies.A.Q1', item: 1, part: null, filled_by: 'code' },
      { slot: 'social_studies.A.Q1', item: 2, part: null, filled_by: 'code' },
    ]);
    const list = itemsOf(exam).filter((q) => q.slot === 'social_studies.A.Q1');
    list[2].removed = true;
    expect(box(schemeOf(exam, 'social_studies'))).toContain('2 marking rows were written from the answer.');
  });

  test('item is the index in the type list; a repeated entry counts once', () => {
    const exam = sst([
      { slot: 'social_studies.A.Q1', item: 4, part: null, filled_by: 'code' },
      { slot: 'social_studies.A.Q1', item: 4, part: null, filled_by: 'code' },
    ]);
    expect(box(schemeOf(clone(exam), 'social_studies'))).toContain('1 marking row was written from the answer.');
    exam.unseen.objective.MCQs[4].removed = true;
    expect(box(schemeOf(exam, 'social_studies'))).not.toMatch(/written from the answer/);
  });

  test('Urdu box line, Urdu digits', () => {
    const one = box(schemeOf(sst([{ slot: 'social_studies.A.Q1', item: 0, part: null, filled_by: 'code' }], 'ur'), 'social_studies'));
    expect(one).toContain('مارکنگ اسکیم کی ۱ سطر جواب سے بنائی گئی ہے۔');
    const two = box(schemeOf(sst([
      { slot: 'social_studies.A.Q1', item: 0, part: null, filled_by: 'code' },
      { slot: 'social_studies.A.Q1', item: 1, part: 'a', filled_by: 'code' },
    ], 'ur'), 'social_studies'));
    expect(two).toContain('مارکنگ اسکیم کی ۲ سطریں جواب سے بنائی گئی ہیں۔');
  });
});
