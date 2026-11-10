import { describe, it, expect } from 'vitest';
import { OWN_COPY } from './copy';
import { bandWords } from './bandCopy';

/** bd-snkn32.19 — the same codes, named for the band: one place decides every band label. */
const C = OWN_COPY as unknown as Parameters<typeof bandWords>[0];

describe('bandWords', () => {
  it('grades 1–5: children, things from around, the primary resource names', () => {
    const w = bandWords(C, 4);
    expect(w.size).toBe('Children in class');
    expect(w.resource('objects')).toBe('Things from around');
    expect(w.objectsHint).toBe('Stones, sticks, bottle caps');
    expect(w.way('phonics')).toBe('Sounds first (phonics)');
  });
  it('grades 6–12: students, lab things, the secondary resource names', () => {
    const w = bandWords(C, 10);
    expect(w.size).toBe('Students in class');
    expect(w.resource('charts')).toBe('Charts or diagrams');
    expect(w.resource('audio')).toBe('Phone (video or audio)');
    expect(w.objectsHint).toBe('Magnets, beakers, a globe, a ruler');
    expect(w.purpose('board')).toBe('Board exam practice');
    expect(w.way('past_paper')).toBe('Past-paper practice');
  });
  it('Grade 8: exam practice is for the FDE exam', () => {
    const w = bandWords(C, 8);
    expect(w.purpose('board')).toBe('Exam practice (FDE)');
    // One name for Grade 8's exam practice, as Amena decided (10 Nov): the way and the purpose read the same.
    expect(w.way('exam_fde')).toBe('Exam practice (FDE)');
    expect(w.purpose('new')).toBe('Teach new');
    expect(w.way('worked')).toBe('Worked examples');
  });
});
