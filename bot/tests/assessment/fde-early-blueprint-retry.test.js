/**
 * bd-5jmnfj.4.13 — an off-blueprint FDE early paper is regenerated once, then flagged to the teacher.
 */
const { withBlueprintRetry, NOTE_EN, NOTE_UR } = require('../../shared/services/assessment/fde-early-blueprint-retry');

const paper = (ok, medium = 'en', id = 'p') => ({
  id, examJson: { _layout: { medium, blueprint: { ok, problems: ok ? [] : ['section A has 9, wants 10'] }, header: { note_en: null, note_ur: null } } },
});
const log = jest.fn();
const noteOf = (p, lang = 'en') => p.examJson._layout.header[`note_${lang}`];

describe('withBlueprintRetry', () => {
  beforeEach(() => log.mockClear());

  it('on blueprint the first time: one write, no note', async () => {
    const write = jest.fn().mockResolvedValue(paper(true));
    const out = await withBlueprintRetry(write, log);
    expect(write).toHaveBeenCalledTimes(1);
    expect(noteOf(out)).toBeNull();
  });

  it('off then on: the second paper, no note', async () => {
    const write = jest.fn().mockResolvedValueOnce(paper(false, 'en', 'first')).mockResolvedValueOnce(paper(true, 'en', 'second'));
    const out = await withBlueprintRetry(write, log);
    expect(write).toHaveBeenCalledTimes(2);
    expect(out.id).toBe('second');
    expect(noteOf(out)).toBeNull();
  });

  it('off then off: delivered with the note, no third write', async () => {
    const write = jest.fn().mockResolvedValueOnce(paper(false, 'en', 'first')).mockResolvedValueOnce(paper(false, 'en', 'second'));
    const out = await withBlueprintRetry(write, log);
    expect(write).toHaveBeenCalledTimes(2);
    expect(out.id).toBe('second');
    expect(noteOf(out)).toContain(NOTE_EN);
  });

  it('an Urdu-medium paper gets the Urdu note, and keeps the note it already had', async () => {
    const first = paper(false, 'ur');
    first.examJson._layout.header.note_ur = 'زبانی حصہ';
    const write = jest.fn().mockResolvedValue(first);
    const out = await withBlueprintRetry(write, log);
    expect(noteOf(out, 'ur')).toBe(`زبانی حصہ ${NOTE_UR}`);
  });

  it('a failed regeneration still delivers the first paper, with the note', async () => {
    const write = jest.fn().mockResolvedValueOnce(paper(false, 'en', 'first')).mockRejectedValueOnce(new Error('boom'));
    const out = await withBlueprintRetry(write, log);
    expect(out.id).toBe('first');
    expect(noteOf(out)).toContain(NOTE_EN);
  });

  it('a paper that met every section target is not re-asked: the whole-paper level miss is in the pattern, not the paper', async () => {
    const exact = paper(false);
    exact.examJson._layout.blueprint.problems = [{ code: 'LEVEL', level: 'Remember', pct: 11.1, target: 20, off: -8.9 }];
    exact.examJson._layout.blueprint.sections = [{ id: 'A', levels: { Remember: { marks: 3, target: 3 }, Apply: { marks: 8, target: 8 } } }];
    const write = jest.fn().mockResolvedValue(exact);
    const out = await withBlueprintRetry(write, log);
    expect(write).toHaveBeenCalledTimes(1);
    expect(noteOf(out)).toBeNull();
  });

  it('a level miss with no section targets to meet is still re-asked', async () => {
    const loose = paper(false, 'en', 'first');
    loose.examJson._layout.blueprint.problems = [{ code: 'LEVEL', level: 'Apply', pct: 40, target: 30, off: 10 }];
    loose.examJson._layout.blueprint.sections = [{ id: 'A', marks: 25, expected: 25 }];
    const write = jest.fn().mockResolvedValueOnce(loose).mockResolvedValueOnce(paper(true, 'en', 'second'));
    const out = await withBlueprintRetry(write, log);
    expect(write).toHaveBeenCalledTimes(2);
    expect(out.id).toBe('second');
  });

  it('the note does not claim a count problem: it asks the teacher to check the paper', () => {
    expect(NOTE_EN).not.toMatch(/section counts/);
  });
});
