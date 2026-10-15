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

describe('the paper file name is printed as it is saved', () => {
  it('an Urdu scheme names Grade5_Urdu_FDE.pdf with an ASCII 5, isolated left-to-right', () => {
    const { scheme } = chain('urdu');
    expect(scheme).toContain('<bdi class="file" dir="ltr">Grade5_Urdu_FDE.pdf</bdi>');
    expect(scheme).not.toMatch(/Grade<span class="num">۵<\/span>/);
  });
});

describe('the MCQ key strip wraps between answers, never inside one', () => {
  it('each "number letter" pair is a no-wrap cell and the separator rides with the pair before it', () => {
    const { scheme } = chain('maths');
    const strip = scheme.slice(scheme.indexOf('<div class="strip"'), scheme.indexOf('</div>', scheme.indexOf('<div class="strip"')));
    expect((strip.match(/<span class="sc">/g) || []).length).toBe(20);
    expect(strip).toContain('<span class="sc">i c ·</span> <span class="sc">ii a ·');
    expect(scheme).toMatch(/\.strip \.sc \{ white-space: nowrap; \}/);
  });
});

describe('the fallback file name is the name the bot saves', () => {
  it('with no paperFileName the box names Grade5_Maths_FDE.pdf (the orchestrator\'s SUBJECT_LABEL), never "Mathematics"', () => {
    const { scheme } = chain('maths');
    expect(scheme).toContain('<bdi class="file" dir="ltr">Grade5_Maths_FDE.pdf</bdi>');
    expect(scheme).not.toContain('Grade5_Mathematics_FDE.pdf');
    expect(chain('science').scheme).toContain('Grade5_Science_FDE.pdf');
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
