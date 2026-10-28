/**
 * Three whole board-pattern papers (Maths, Urdu, Science) through the real
 * pure chain the engine will run: applyLayout → normaliseScheme → mathsCheck
 * → paper HTML → marking-scheme HTML. Every slot is filled, nothing is short,
 * the header total is 100, and the one planted wrong maths key (52.8 ÷ 1.2
 * written as 44.5) is corrected to 44 in the answer and the scheme.
 *
 * Pure: no browser, no network.
 */

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const { mathsCheck } = require('../../bot/shared/services/assessment/maths-check');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const NOW = '2026-10-20T07:12:00.000Z';
const P = Patterns.get('fde_g5_2027');

function chain(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
  const laid = applyLayout(raw, P.subjects[name], { kind: 'fde' }, { now: NOW });
  const ns = normaliseScheme(laid.examJson);
  const mc = mathsCheck(ns.examJson, { subject: name });
  const exam = mc.examJson;
  const paper = R.renderPaper({ examJson: exam, grade: 5, subject: name, answerLines: true });
  const scheme = R.renderMarkingScheme({ examJson: exam, grade: 5, subject: name });
  return { laid, ns, mc, exam, paper, scheme };
}

const PLACED = { maths: 48, urdu: 35, science: 41 };

describe.each(Object.keys(PLACED))('the %s fixture through the whole chain', (name) => {
  const run = chain(name);

  it('places every item, leaves no slot short and the scheme complete', () => {
    expect(run.laid.placed).toBe(PLACED[name]);
    expect(run.laid.unplaced).toBe(0);
    expect(run.laid.shortfall).toEqual([]);
    expect(run.ns.shortfall).toEqual([]);
  });

  it('prints a paper and a scheme whose total is 100', () => {
    expect(R.totalMarks(run.exam)).toBe(100);
    expect(run.paper).toMatch(/^<!DOCTYPE html>/);
    expect(run.scheme).toMatch(/^<!DOCTYPE html>/);
    expect(run.scheme).toContain('class="record"');
  });
});

describe('the maths fixture key check', () => {
  it('corrects the one planted wrong key, in the answer and the scheme', () => {
    const { mc, scheme } = chain('maths');
    expect(mc.replaced).toBe(1);
    expect(scheme).toMatch(/key corrected by code; the model wrote 44\.5/);
  });
});

describe('either/or questions stay whole on the page', () => {
  it('a question with "یا"/"OR" alternatives is one unbreakable block, and the "یا" never ends a page', () => {
    const { paper } = chain('urdu');
    const before = paper.slice(0, paper.indexOf('data-slot="urdu.C.Q10"'));
    const opens = before.match(/<div class="slot[" ][^>]*>/g);
    expect(opens[opens.length - 1]).toBe('<div class="slot either">');
    expect(paper).toMatch(/\.slot\.either \{[^}]*break-inside: avoid/);
    expect(paper).toMatch(/\.or \{[^}]*break-before: avoid; break-after: avoid/);
  });
});

describe('the Urdu egress rule reaches list numbers', () => {
  it('the before-the-exam steps in an Urdu scheme are numbered in Urdu digits, not 1. 2. 3.', () => {
    const { scheme } = chain('urdu');
    expect(scheme).toMatch(/@counter-style urdu-steps \{ system: numeric; symbols: '۰' '۱' '۲' '۳' '۴' '۵' '۶' '۷' '۸' '۹'; suffix: '۔ '; \}/);
    expect(scheme).toMatch(/\.box ol \{[^}]*list-style-type: urdu-steps/);
    expect(chain('maths').scheme).not.toContain('urdu-steps');
  });
});

describe('the scheme prints no file name (bd-5jmnfj.4.50.5)', () => {
  it('an Urdu scheme names no .pdf file and no Grade<5> file stem', () => {
    const { scheme } = chain('urdu');
    expect(scheme).not.toContain('Grade5_Urdu_FDE.pdf');
    expect(scheme).not.toMatch(/Grade<span class="num">۵<\/span>/);
  });
});

describe('the MCQ key strip wraps between answers, never inside one', () => {
  it('each "number letter" pair is a no-wrap cell and the separator rides with the pair before it', () => {
    const { scheme } = chain('maths');
    const strip = scheme.slice(scheme.indexOf('<div class="strip"'), scheme.indexOf('</div>', scheme.indexOf('<div class="strip"')));
    expect((strip.match(/<span class="sc">/g) || []).length).toBe(20);
    // The letters themselves are spread by the layout; the cell shape is what this pins.
    expect(strip).toMatch(/<span class="sc">i [a-d] ·<\/span> <span class="sc">ii [a-d] ·/);
    expect(scheme).toMatch(/\.strip \.sc \{ white-space: nowrap; \}/);
  });
});

describe('the box names the question paper, not a file (bd-5jmnfj.4.50.5)', () => {
  it('maths and science schemes print no _FDE.pdf name', () => {
    expect(chain('maths').scheme).not.toMatch(/_FDE\.pdf/);
    expect(chain('science').scheme).not.toMatch(/_FDE\.pdf/);
  });
});

describe('Urdu numbers read the right way round', () => {
  // Urdu digits are bidi class AN: inside an LTR isolate a dash between two of
  // them still resolves right-to-left, so «2026–27» printed as «27–2026».
  it('a range or sum in an Urdu-digit atom pins its separators left-to-right with LRM', () => {
    const { scheme } = chain('urdu');
    expect(scheme).toContain('<span class="num">۲۰۲۶‎–‎۲۷</span>');
    expect(scheme).toContain('<span class="num">۴‎–‎۱۰</span>');
  });

  it('no · stands beside an Urdu-digit atom (it reads as ۰); an Urdu comma is used instead', () => {
    const { scheme, paper } = chain('urdu');
    for (const html of [scheme, paper]) {
      expect(html).not.toMatch(/·\s*<span class="num">|<\/span>\s*·/);
    }
    expect(scheme).toMatch(/قواعد، <span class="num">۱‎–‎۳<\/span>/);
  });
});

describe('panel round 1', () => {
  it('C4: the Urdu paper prints FDE\'s part-ب header (p.57) above its two sub-parts', () => {
    const { paper } = chain('urdu');
    const head = '<div class="part-head"><span class="lab">ب:</span> <span class="ins">دی گئی ہدایات کے مطابق حل کریں۔</span><span class="ml"><span class="num">۱۰</span></span></div>';
    // Inside the first sub-part's unbreakable block, so the header never ends a page alone.
    expect(paper).toContain(`<div class="part">${head}<div class="part-head"><span class="ins">سوال: پیراگراف سے چن کر لکھیں۔</span><span class="ml"><span class="num">۰۸</span></span></div>`);
  });

  it('C1: the Urdu box\'s "tell the class" line names every choice on the paper: Q3, Q5, Q6, Q8, Q9, Q10', () => {
    const { scheme } = chain('urdu');
    const box = scheme.slice(scheme.indexOf('class="box before"'), scheme.indexOf('</ol>', scheme.indexOf('class="box before"')));
    const line4 = box.split('<li>')[4];
    const order = ['۳', '۵', '۶', '۸', '۹', '۱۰'].map((d) => line4.indexOf(`سوال نمبر <span class="num">${d}</span>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(line4).toContain('<span class="num">۷</span> میں سے کوئی سے <span class="num">۵</span>');
    expect(line4).toContain('دو میں سے ایک');
  });

  it('C3: every written row group in the scheme opens with its slot head', () => {
    const heads = (html) => (html.match(/<tr class="slot-row"[^>]*><td colspan="3">([\s\S]*?)<\/td><\/tr>/g) || []).map((h) => h.replace(/<[^>]+>/g, ''));
    const sci = heads(chain('science').scheme).map((h) => h.split(/\s/)[0] + ' ' + (h.split(/\s/)[1] || ''));
    expect(sci.join('|')).toMatch(/Q2 \(a\).*\|Q2 \(b\).*\|Q3 \(a\).*\|Q3 \(b\)/);
    const ur = chain('urdu').scheme;
    const q4 = ur.indexOf('<tr class="slot-row" data-slot-head="urdu.C.Q4">');
    expect(q4).toBeGreaterThan(ur.indexOf('<tr class="slot-row" data-slot-head="urdu.C.Q3">'));
    expect(ur.indexOf('<tr data-row="urdu.C.Q4"')).toBeGreaterThan(q4);
    expect(ur.indexOf('data-row="urdu.C.Q6-fixed"')).toBeGreaterThan(ur.indexOf('<tr class="slot-row" data-slot-head="urdu.C.Q6">'));
  });

  it('C2: a written row with no points prints an A point worth its marks (Science Q2(b) sub-questions, 2.5 each)', () => {
    const { scheme } = chain('science');
    const rows = scheme.match(/<tr data-row="science\.B\.Q2b">[\s\S]*?<\/tr>/g) || [];
    expect(rows.length).toBe(9);
    for (const r of rows) expect(r).toMatch(/<td class="pts"><span class="pt"><span class="chip">A2\.5<\/span>/);
  });

  it('C6: composition criteria marks in an Urdu scheme are Urdu digits', () => {
    const { scheme } = chain('urdu');
    expect(scheme).toMatch(/<span class="crit-m"><span class="num">[۰-۹]/);
    expect(scheme).not.toMatch(/<span class="crit-m">[0-9]/);
  });

  it('C7: a comprehension item may break after its passage (parts stay whole), so it never leaves a near-empty page', () => {
    const { paper } = chain('urdu');
    expect(paper).toContain('<div class="q comp" data-slot="urdu.B.Q2">');
    expect(paper).toMatch(/\.q\.comp \{ break-inside: auto; \}/);
    expect(paper).toMatch(/\.passage \{[^}]*break-inside: avoid/);
  });
});
