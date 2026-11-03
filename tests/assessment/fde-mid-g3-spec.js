'use strict';
/** Shared checks for the Grade 3 FDE subjects (bd-5jmnfj.33.1): one call registers the tests for one subject. */

const BAND = ['Remember', 'Understand', 'Apply'];

/**
 * spec: { key, medium, tos, gen, sections: [{ id, marks, slots: [[name, generate, attempt, marks_each]] }] }
 * Slot ids are g3.<key>.<section>.<name>, in order.
 */
function checkSubject(subject, spec) {
  const secs = subject.sections;
  const slots = secs.flatMap((s) => s.slots);

  test('key, medium, grade, total 50 and no oral', () => {
    expect(subject.key).toBe(spec.key);
    expect(subject.medium).toBe(spec.medium);
    expect(subject.grade).toBe(3);
    expect(subject.total_marks).toBe(50);
    expect(subject.oral_marks).toBe(0);
    expect(subject.oral).toBeNull();
    expect(subject.g5_rules).toBe(false);
  });

  test('tos exact', () => expect(subject.tos).toEqual(spec.tos));

  test('sections and marks as designed', () => {
    expect(secs.map((s) => [s.id, s.marks])).toEqual(spec.sections.map((s) => [s.id, s.marks]));
  });

  test('slots as designed: id, generate, attempt, marks each', () => {
    const want = spec.sections.flatMap((s) => s.slots.map(([name, gen, att, each]) => [`g3.${spec.key}.${s.id}.${name}`, gen, att, each]));
    expect(slots.map((s) => [s.slot, s.generate, s.attempt, s.marks_each])).toEqual(want);
  });

  test(`generates ${spec.gen} items`, () => {
    expect(slots.reduce((n, s) => n + s.generate, 0)).toBe(spec.gen);
  });

  test('levels sum to each section and the three bands are within 5 marks of tos x 50', () => {
    secs.forEach((s) => expect(BAND.reduce((n, b) => n + (s.levels[b] || 0), 0)).toBe(s.marks));
    BAND.forEach((b) => {
      const got = secs.reduce((n, s) => n + (s.levels[b] || 0), 0);
      expect(Math.abs(got - (spec.tos[b] * 50) / 100)).toBeLessThanOrEqual(5);
    });
  });

  test('slot ids unique, prefixed, named last segment, labels Q1.. in order', () => {
    const ids = slots.map((s) => s.slot);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => {
      expect(id.startsWith(`g3.${spec.key}.`)).toBe(true);
      expect(id.split('.').pop()).not.toMatch(/^Q\d/);
    });
    expect(slots.map((s) => s.label_en)).toEqual(slots.map((_, i) => `Q${i + 1}.`));
  });

  test('no picture, frame or arrow keys', () => {
    slots.forEach((s) => {
      expect(s.picture).toBeNull();
      expect(s.picture_only).toBe(false);
      expect(s.frame).toBeNull();
      expect(s.prompt_rule).not.toMatch(/→|->|picture:/);
    });
  });

  test('every slot has a real prompt_rule; a choice says so in its instruction', () => {
    const lang = spec.medium === 'ur' ? 'instruction_ur' : 'instruction_en';
    const word = spec.medium === 'ur' ? /کوئی/ : /any/i;
    slots.forEach((s) => {
      expect(String(s.prompt_rule).length).toBeGreaterThan(60);
      if (s.attempt < s.generate) expect(s[lang]).toMatch(word);
      expect(s[lang]).toBeTruthy();
    });
  });

  test('no religious content in a prompt rule or an instruction', () => {
    const bad = /hamd|naat|quran|hadith|islamiat|حمد|نعت|قرآن|حدیث|اسلامیات|آیت/i;
    slots.forEach((s) => expect(`${s.prompt_rule} ${s.instruction_en || ''} ${s.instruction_ur || ''}`.replace(/no (religious|Hamd)[^.]*\./gi, '')).not.toMatch(bad));
  });

  test('no teacher names, phones or ids', () => {
    expect(JSON.stringify(subject)).not.toMatch(/\b03\d{9}\b|\+92/);
  });
}

module.exports = { checkSubject };
