/**
 * FDE's split by thinking level, per section (bd-5jmnfj.19). Each section is written by its own
 * model call; told only the whole paper's split, every section tried to carry it alone (Maths
 * Section A came out 30% Apply, Urdu's MCQs 40%). FDE's table sets the split by unit; mapped onto
 * the sections (GRADE V MODEL PAPERS CAE 2026, Maths p.5-12, Urdu p.48-51) each section gets its own.
 *
 * Pure: no model, no network.
 */

const fs = require('fs');
const path = require('path');
const Gen = require('../../bot/shared/services/assessment/assessment-generation.service');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const { checkBlueprint, levelNote } = require('../../bot/shared/services/assessment/blueprint-check');

const P = Patterns.get('fde_g5_2027').subjects;
const FDE = { kind: 'fde', chapters: null, pages: null };
const LEVELS = ['Remember', 'Understand', 'Apply'];

function prompt(subject, sectionId) {
  const S = P[subject];
  const section = S.sections.find((s) => s.id === sectionId);
  return Gen.buildPatternUserPrompt({
    grade: 5, subject, pageContent: 'Book text.', pageReference: '1-20',
    section, slots: section.slots, lang: S.medium, P: S, scope: FDE,
  });
}
const sectionLevels = (subject) => Object.fromEntries(P[subject].sections.map((s) => [s.id, s.levels]));
function laid(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', `${name}.json`), 'utf8'));
  return applyLayout(raw, P[name], FDE, { now: '2026-10-20T07:12:00.000Z' }).examJson;
}

describe('the pattern carries FDE\'s split per section', () => {
  it.each([
    ['maths', { A: [10, 30, 0], B: [0, 20, 20], C: [0, 0, 20] }],
    ['urdu', { A: [20, 0, 0], B: [0, 20, 0], C: [10, 10, 40] }],
  ])('%s', (subject, want) => {
    const S = P[subject];
    for (const sec of S.sections) {
      expect(LEVELS.map((b) => sec.levels[b])).toEqual(want[sec.id]);
      expect(LEVELS.reduce((n, b) => n + sec.levels[b], 0)).toBe(sec.marks);
    }
    // The sections add up to FDE's whole-paper split.
    for (const b of LEVELS) {
      expect(S.sections.reduce((n, s) => n + s.levels[b], 0)).toBe(S.tos[b] * S.total_marks / 100);
    }
  });
});

describe('a section is asked for its own split', () => {
  it('Maths Section A: Remember and Understand only', () => {
    expect(prompt('maths', 'A')).toContain('This section\'s 40 marks split by thinking level as Remember 10, Understand 30, Apply 0');
  });
  it('Maths Section C: all Apply', () => {
    expect(prompt('maths', 'C')).toContain('This section\'s 20 marks split by thinking level as Remember 0, Understand 0, Apply 20');
  });
  it('Urdu Section C names its writing tasks as Apply', () => {
    const text = prompt('urdu', 'C');
    expect(text).toContain('This section\'s 60 marks split by thinking level as Remember 10, Understand 10, Apply 40');
    expect(text).toMatch(/picture description, paragraph, story and letter or application are Apply/);
  });
  it('a subject with no per-section split keeps the whole-paper line alone', () => {
    const text = prompt('science', 'A');
    expect(text).toContain('Across the whole paper the marks split by thinking level is');
    expect(text).not.toContain('This section\'s');
  });
});

describe('the blueprint reads each section against its own split', () => {
  const r = checkBlueprint(laid('maths'), { tos: P.maths.tos, sectionLevels: sectionLevels('maths') });

  it('reports each section\'s marks by level', () => {
    for (const s of r.sections) {
      expect(LEVELS.reduce((n, b) => n + s.levels[b].marks, 0)).toBeCloseTo(s.marks, 5);
      expect(LEVELS.map((b) => s.levels[b].target)).toEqual(LEVELS.map((b) => P.maths.sections.find((x) => x.id === s.id).levels[b]));
    }
  });

  it('flags a section more than 5 marks off its own split, naming the section and level', () => {
    for (const p of r.problems.filter((x) => x.code === 'SECTION_LEVEL')) {
      expect(Math.abs(p.marks - p.target)).toBeGreaterThan(5);
      expect(['A', 'B', 'C']).toContain(p.section);
    }
    expect(r.problems.some((x) => x.code === 'SECTION_LEVEL')).toBe(true);
  });

  it('without section splits, nothing changes', () => {
    const plain = checkBlueprint(laid('maths'), { tos: P.maths.tos });
    expect(plain.problems.some((x) => x.code === 'SECTION_LEVEL')).toBe(false);
  });
});

describe('the re-ask tells each section where it stood', () => {
  const bp = checkBlueprint(laid('maths'), { tos: P.maths.tos, sectionLevels: sectionLevels('maths') });
  const note = levelNote(bp);

  it('one note per section, each carrying the paper\'s split and that section\'s own', () => {
    expect(Object.keys(note)).toEqual(['A', 'B', 'C']);
    for (const id of ['A', 'B', 'C']) {
      expect(note[id]).toMatch(/Remember 10%, Understand 50%, Apply 40%/);
      expect(note[id]).toMatch(/This section came out at Remember \d+, Understand \d+, Apply \d+ marks/);
    }
    expect(note.A).toContain('FDE\'s split for it is Remember 10, Understand 30, Apply 0');
  });

  it('a paper with no section splits gets the one paper-level note, as before', () => {
    expect(typeof levelNote(checkBlueprint(laid('maths'), { tos: P.maths.tos }))).toBe('string');
  });
});

describe('Urdu Q4 and Q5 are Understand', () => {
  // Sandbox run 2026-10-19: Q4 (rewrite) and Q5 (word in a sentence) came back Apply, putting C 9 marks over.
  it('Section C names them', () => {
    expect(prompt('urdu', 'C')).toMatch(/rewrite-the-sentences \(Q4\) and use-the-words-in-sentences \(Q5\) items are Understand/);
  });
  it('no other section is told', () => {
    expect(prompt('urdu', 'A')).not.toMatch(/\(Q4\)/);
  });
});

describe('Urdu Section C split fits its questions', () => {
  // With Q4+Q5 (10 marks) Understand, only Q3 and Q6 (5 each) are left for Remember: C cannot reach R15/U5.
  it('C is R10 U10 A40 and A carries the rest of Remember', () => {
    expect(sectionLevels('urdu').C).toEqual({ Remember: 10, Understand: 10, Apply: 40 });
    expect(sectionLevels('urdu').A).toEqual({ Remember: 20, Understand: 0, Apply: 0 });
  });
  it('the sections still add up to the ToS', () => {
    const sum = Object.fromEntries(LEVELS.map((b) => [b, P.urdu.sections.reduce((n, s) => n + s.levels[b], 0)]));
    expect(sum).toEqual(P.urdu.tos);
  });
});
