/**
 * The FDE Grade 5 board pattern as data.
 *
 * Everything that decides what a board-pattern paper IS lives in one frozen
 * module, so it can be checked here without running a model: the marks add up,
 * a slot never asks for more answers than it prints, every printed count is an
 * atom the renderer recomputes, and the Urdu paper is set from lessons 4–10 only.
 *
 * Pure data, no I/O.
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');

const ID = 'fde_g5_2027';
const SUBJECTS = ['maths', 'science', 'english', 'urdu', 'social_studies'];

function slotsOf(subject) {
  return subject.sections.flatMap((s) => s.slots);
}

function slotTotal(slot) {
  if (Array.isArray(slot.parts) && slot.parts.length) {
    return slot.attempt * slot.parts.reduce((a, b) => a + b, 0);
  }
  return slot.attempt * slot.marks_each;
}

// Every `{k:v}` atom stripped to its value: the line FDE printed.
function verbatim(s) {
  return String(s).replace(/\{[wntg]:([^}]*)\}/g, '$1');
}

function allStrings(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((n) => allStrings(n, out));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => allStrings(n, out));
  return out;
}

describe('the registry', () => {
  it('lists Grade 5 first, then the early grades', () => {
    expect(Patterns.list()).toEqual([ID, 'fde_g1_2026', 'fde_g2_2026']);
  });

  it('returns null for an unknown id', () => {
    expect(Patterns.get('nope')).toBeNull();
  });

  it('is deep-frozen', () => {
    const P = Patterns.get(ID);
    expect(Object.isFrozen(P)).toBe(true);
    expect(Object.isFrozen(P.subjects.maths.sections[1].slots[0])).toBe(true);
    expect(() => { 'use strict'; P.subjects.maths.total_marks = 5; }).toThrow();
  });

  it('carries exactly the five eligible subjects and never Islamiat', () => {
    expect(Object.keys(Patterns.get(ID).subjects).sort()).toEqual([...SUBJECTS].sort());
  });
});

describe('every subject adds up', () => {
  it.each(SUBJECTS)("every subject's sections sum to total: %s", (key) => {
    const S = Patterns.get(ID).subjects[key];
    let sum = 0;
    for (const sec of S.sections) {
      const secSum = sec.slots.reduce((a, s) => a + slotTotal(s), 0);
      expect({ section: sec.id, marks: secSum }).toEqual({ section: sec.id, marks: sec.marks });
      sum += secSum;
    }
    expect(sum).toBe(S.total_marks);
    expect(S.total_marks).toBe(100);
  });

  it.each(SUBJECTS)('attempt ≤ generate on every slot: %s', (key) => {
    for (const slot of slotsOf(Patterns.get(ID).subjects[key])) {
      expect({ slot: slot.slot, ok: slot.attempt <= slot.generate && slot.attempt >= 1 })
        .toEqual({ slot: slot.slot, ok: true });
    }
  });

  it.each(SUBJECTS)('slot ids are <subject>.<section>.<label> and unique: %s', (key) => {
    const ids = slotsOf(Patterns.get(ID).subjects[key]).map((s) => s.slot);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id.startsWith(`${key}.`)).toBe(true));
  });
});

describe('counts are atoms, never typed', () => {
  it.each(SUBJECTS)('every choice line holds its count atom: %s', (key) => {
    const S = Patterns.get(ID).subjects[key];
    const lang = S.medium;
    for (const sec of S.sections) {
      for (const slot of sec.slots) {
        if (slot.attempt < slot.generate && !slot.or) {
          const covered = sec.note_slot === slot.slot
            ? sec[`note_${lang}`] : slot[`instruction_${lang}`];
          expect({ slot: slot.slot, hasW: /\{w:[^}]+\}/.test(covered || '') })
            .toEqual({ slot: slot.slot, hasW: true });
        }
      }
    }
  });

  it('the Maths strings are FDE verbatim once the atoms are stripped', () => {
    const M = Patterns.get(ID).subjects.maths;
    const [A, B, C] = M.sections;
    expect(verbatim(M.header.time_line_en)).toBe('Time Allowed: 3 Hrs.');
    expect(verbatim(M.header.total_line_en)).toBe('Total Marks: 100');
    expect(verbatim(B.slots[0].instruction_en)).toBe('Attempt any eight questions. All questions carry equal marks.');
    expect(verbatim(B.slots[0].marks_line_en)).toBe('(8×5=40)');
    expect(verbatim(A.slots[1].marks_line_en)).toBe('Marks: (2×10=20)');
    expect(verbatim(C.note_en)).toMatch(/^Note: Q3 is compulsory\. Attempt any three from the remaining questions\. All questions carry 5 marks each\. \(4 ?× ?5 ?= ?20\)$/);
  });

  it('arithmetic atoms agree with the slot numbers', () => {
    const B = Patterns.get(ID).subjects.maths.sections[1];
    const q2 = B.slots[0];
    expect(q2.marks_line_en).toMatch(/\{n:8\}/);
    expect(q2.marks_line_en).toMatch(/\{t:40\}/);
    expect(q2.attempt * q2.marks_each).toBe(40);
  });
});

describe('scope', () => {
  it('urdu pages within 28–107 and held = [1,2,3]', () => {
    const U = Patterns.get(ID).subjects.urdu.scope;
    expect(U.page_ranges).toBe('28-107');
    expect(U.held).toEqual([1, 2, 3]);
    expect(U.chapter_numbers).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(U.display_chapters).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const part of U.page_ranges.split(',')) {
      const [a, b] = part.trim().split('-').map(Number);
      expect(a).toBeGreaterThanOrEqual(28);
      expect(b).toBeLessThanOrEqual(107);
    }
  });

  it('scopeFor maths returns the 12 ranges', () => {
    const s = Patterns.scopeFor(ID, 'maths');
    expect(s.page_ranges).toBe('1-12, 14-40, 42-66, 68-90, 92-116, 118-144, 155-168, 171-180, 218-226, 239-244, 254-257, 267-271');
    expect(s.page_ranges.split(',')).toHaveLength(12);
    expect(s.chapters).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 12]);
  });

  it('scopeFor narrows Maths sections to their units', () => {
    const s = Patterns.scopeFor(ID, 'math');
    expect(s.section_ranges.B).toBe('1-12, 14-40, 42-66, 68-90, 92-116, 118-144, 155-168, 171-180');
    expect(s.section_ranges.C).toBe('218-226, 239-244, 254-257, 267-271');
    expect(s.section_ranges.A).toBe(s.page_ranges);
  });

  it('scopeFor urdu keeps lessons 1–3 out', () => {
    const s = Patterns.scopeFor(ID, 'urdu');
    expect(s.page_ranges).toBe('28-107');
    expect(s.held).toEqual([1, 2, 3]);
  });

  it('scopeFor of an ineligible subject is null', () => {
    expect(Patterns.scopeFor(ID, 'islamiat')).toBeNull();
  });
});

describe('eligibility', () => {
  it.each(SUBJECTS)('grade 5 %s is eligible', (key) => {
    expect(Patterns.isEligible(ID, 5, key)).toBe(true);
    expect(Patterns.isEligible(ID, '5', key)).toBe(true);
  });

  it('aliases normalise (math, sst)', () => {
    expect(Patterns.isEligible(ID, 5, 'math')).toBe(true);
    expect(Patterns.isEligible(ID, 5, 'sst')).toBe(true);
  });

  it('islamiat not eligible', () => {
    expect(Patterns.isEligible(ID, 5, 'islamiat')).toBe(false);
  });

  it('grade 4 not eligible', () => {
    expect(Patterns.isEligible(ID, 4, 'maths')).toBe(false);
    expect(Patterns.isEligible(ID, null, 'maths')).toBe(false);
  });

  it('an unknown pattern is not eligible', () => {
    expect(Patterns.isEligible('fde_g4', 5, 'maths')).toBe(false);
  });
});

describe('summaryFor', () => {
  it.each(SUBJECTS)('summaryFor returns en+ur for all five: %s', (key) => {
    const s = Patterns.summaryFor(ID, key);
    for (const lang of ['en', 'ur']) {
      expect(typeof s.name[lang]).toBe('string');
      expect(typeof s.holds[lang]).toBe('string');
      expect(typeof s.files[lang]).toBe('string');
      expect(typeof s.scope[lang]).toBe('string');
      expect(typeof s.totalTime[lang]).toBe('string');
      expect(typeof s.waitHint[lang]).toBe('string');
      s.sections.forEach((sec) => expect(typeof sec[lang]).toBe('string'));
    }
    expect(s.id).toBe(ID);
    expect(s.totalMarks).toBe(100);
    expect(s.generateTotal).toBe(Patterns.expandTypes(ID, key).reduce((a, t) => a + t.count, 0));
    expect(s.holds.en).toContain(`${s.generateTotal} questions`);
  });

  it('maths summary says what the Check row shows', () => {
    const s = Patterns.summaryFor(ID, 'maths');
    expect(s.holds.en).toBe('3 sections · 100 marks · 3 hrs · 48 questions');
    expect(s.choice.en).toBe('Q2: attempt any 8 of 12 · 5 each');
    expect(s.youAdd).toBeNull();
    expect(s.scope.chapters).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 12]);
    expect(s.scope.unitRanges[0]).toEqual({ chapter: 1, ranges: '1-12' });
  });

  it('summary.choices lists every slot that offers a choice', () => {
    const s = Patterns.summaryFor(ID, 'maths');
    expect(s.choices).toEqual([
      { slot: 'maths.B.Q2', label_en: 'Q2', label_ur: expect.any(String), generate: 12, attempt: 8, marks_each: 5 },
      { slot: 'maths.C.Q4-8', label_en: 'Q4–Q8', label_ur: expect.any(String), generate: 5, attempt: 3, marks_each: 5 },
    ]);
  });

  it('science, english, urdu and sst name what the teacher adds', () => {
    expect(Patterns.summaryFor(ID, 'science').youAdd.en).toBe('the diagram to label');
    expect(Patterns.summaryFor(ID, 'english').youAdd.en).toBe('the picture');
    expect(Patterns.summaryFor(ID, 'urdu').youAdd.en).toBe('the picture');
    expect(Patterns.summaryFor(ID, 'social_studies').youAdd.en).toBe('the map of Pakistan');
  });

  it('UR app lines never put · beside an Urdu-Indic digit', () => {
    for (const key of SUBJECTS) {
      for (const str of allStrings(Patterns.summaryFor(ID, key))) {
        expect({ key, str, bad: /[۰-۹]\s*·|·\s*[۰-۹]/.test(str) }).toEqual({ key, str, bad: false });
      }
    }
  });

  it('summaryFor of an ineligible subject is null', () => {
    expect(Patterns.summaryFor(ID, 'islamiat')).toBeNull();
  });
});

describe('expandTypes', () => {
  it('maths expands to one entry per slot with generate counts', () => {
    expect(Patterns.expandTypes(ID, 'maths')).toEqual([
      { id: 'MCQs', count: 20, category: 'objective', slot: 'maths.A.Q1a' },
      { id: 'Short Questions', count: 10, category: 'subjective', slot: 'maths.A.Q1b' },
      { id: 'Word Problems', count: 12, category: 'subjective', slot: 'maths.B.Q2' },
      { id: 'Graphs & Geometric Problems', count: 1, category: 'subjective', slot: 'maths.C.Q3' },
      { id: 'Graphs & Geometric Problems', count: 5, category: 'subjective', slot: 'maths.C.Q4-8' },
    ]);
  });

  it('urdu never asks the model for the Naat alternative', () => {
    const q6 = Patterns.expandTypes(ID, 'urdu').find((t) => t.slot === 'urdu.C.Q6');
    expect(q6.count).toBe(1);
  });

  it('objective slots come before every subjective one, so the stored tree reads in pattern order', () => {
    for (const key of SUBJECTS) {
      const cats = Patterns.expandTypes(ID, key).map((t) => t.category);
      const firstSubj = cats.indexOf('subjective');
      expect({ key, objectiveAfter: cats.slice(firstSubj).includes('objective') })
        .toEqual({ key, objectiveAfter: false });
    }
  });

  it('is empty for an ineligible subject', () => {
    expect(Patterns.expandTypes(ID, 'islamiat')).toEqual([]);
  });
});

describe('slot details the engine and renderer read', () => {
  it('maths Q2 is four families of three; Section C is one of each kind', () => {
    const M = Patterns.get(ID).subjects.maths;
    const q2 = M.sections[1].slots[0];
    expect(q2.families).toHaveLength(4);
    q2.families.forEach((f) => expect(f.kinds).toEqual(['number_sense', 'computation', 'word_problem']));
    expect(q2.families.map((f) => f.units)).toEqual(['1-2', '3-4', '5-6', '7-8']);
    expect(M.sections[2].slots[1].kinds).toEqual(['draw', 'area', 'perimeter', 'average', 'missing_angle']);
  });

  it('every slot carries shape, numbering, grain and a prompt rule', () => {
    for (const key of SUBJECTS) {
      for (const slot of slotsOf(Patterns.get(ID).subjects[key])) {
        expect({ slot: slot.slot, shape: typeof slot.shape, numbering: typeof slot.numbering,
          grain: typeof slot.grain, rule: typeof slot.prompt_rule })
          .toEqual({ slot: slot.slot, shape: 'string', numbering: 'string', grain: 'object', rule: 'string' });
      }
    }
  });

  it('Section A written items get a working box; B and C none', () => {
    const M = Patterns.get(ID).subjects.maths;
    expect(M.sections[0].slots[1].lines).toBe(2);
    expect(M.sections[0].slots[1].work_mm).toBe(30);
    M.sections.slice(1).forEach((s) => s.slots.forEach((slot) => expect(slot.lines).toBe(0)));
  });

  it('every picture slot carries a frame and a teacher note, never "look at the picture"', () => {
    const frames = [];
    for (const key of SUBJECTS) {
      for (const slot of slotsOf(Patterns.get(ID).subjects[key])) {
        if (slot.shape === 'frame') {
          frames.push(slot.slot);
          expect(slot.frame).toEqual(expect.objectContaining({ height_mm: expect.any(Number), kind: expect.any(String) }));
          expect(typeof slot.teacher_note_en).toBe('string');
          expect(typeof slot.teacher_note_ur).toBe('string');
        }
      }
    }
    expect(frames.sort()).toEqual(['english.C.Q10', 'science.A.Q1b', 'social_studies.A.Q2', 'urdu.C.Q7']);
    const text = allStrings(Patterns.get(ID)).join('\n');
    expect(text).not.toMatch(/look at the (picture|figure)/i);
  });

  it('urdu Q6 has the fixed Naat alternative with no key and the 3·1·1 split', () => {
    const q6 = slotsOf(Patterns.get(ID).subjects.urdu).find((s) => s.slot === 'urdu.C.Q6');
    expect(q6.alternatives).toHaveLength(2);
    expect(q6.alternatives[0]).toEqual(expect.objectContaining({ kind: 'fixed', key: null, split: [3, 1, 1] }));
    expect(typeof q6.alternatives[0].instruction_ur).toBe('string');
    expect(q6.alternatives[1]).toEqual(expect.objectContaining({ kind: 'seen_verses', source_chapter: 7, generate: true }));
  });

  it('the legend has its title and six lines in both languages; the box six', () => {
    const S = Patterns.get(ID).subjects.maths;
    expect(typeof S.legend.title_en).toBe('string');
    expect(S.legend.lines_en).toHaveLength(6);
    expect(S.legend.lines_ur).toHaveLength(6);
    expect(S.before_exam.lines_en).toHaveLength(6);
    expect(S.before_exam.lines_ur).toHaveLength(6);
  });

  it('the header never claims to be the board', () => {
    const text = allStrings(Patterns.get(ID)).join('\n');
    expect(text).not.toMatch(/MODEL PAPER FOR/i);
    expect(text).not.toMatch(/Islamabad Model School/);
  });

  it('no string carries a review mark or filler', () => {
    const text = allStrings(Patterns.get(ID)).join('\n');
    expect(text).not.toMatch(/needs review|filler|⚠/i);
    expect(text).not.toMatch(/مسودہ|اسی طرح/);
  });
});

describe('the operator\'s Urdu rule: a pattern is a "pattern", not a طرز', () => {
  it('no Urdu string says طرز; the paper titles read «FDE pattern کا مشقی پرچہ»', () => {
    const mod = require('../../bot/shared/services/assessment/patterns/fde-g5-2027');
    expect(JSON.stringify(mod)).not.toContain('طرز');
    const subjects = require('../../bot/shared/services/assessment/patterns').get('fde_g5_2027').subjects;
    for (const key of Object.keys(subjects)) {
      const t = subjects[key].header && subjects[key].header.title_ur;
      if (t) expect(t).toMatch(/FDE pattern کا مشقی پرچہ$/);
    }
  });
});
