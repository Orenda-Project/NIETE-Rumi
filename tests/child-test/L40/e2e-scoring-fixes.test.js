/**
 * Three scoring defects found by the first v3 sandbox e2e (5 synthetic children, 4 Oct night; bd-s1oo0.50.9).
 * 1. renderTurns cut every turn at 500 characters. When diarization collapses to one speaker the story, the
 *    questions and the answers become one turn, so the listening grader never saw a question (0/6, twice).
 * 2. The quick-sum begin lines carry a bracketed stage direction ("[point to the first problem]") that the
 *    coach does not say aloud, so the cue never matched: ma.add1/ma.sub1 found 0 of 10 clocks.
 * 3. With no cue, the inferred clock took the first item-like word anywhere in the note (65.7 s for one
 *    child), so the 60-s window missed the task ("task not found").
 */
const { clean } = require('../../../bot/shared/services/child-test/scoring/text-norm');
const { renderTurns } = require('../../../bot/shared/services/child-test/scoring/stt');
const C = require('../../../bot/shared/services/child-test/scoring/tasks/common');
const IB = require('../../../bot/shared/services/child-test/item-bank');

const say = (text, start, step = 0.3, speaker = '1') => text.split(/\s+/).filter(Boolean).map((raw, k) => ({
  w: clean(raw), raw, start: start + k * step, end: start + k * step + 0.25, speaker,
}));

describe('renderTurns keeps every word', () => {
  it('a one-speaker note longer than 500 characters keeps its last words (the questions)', () => {
    const story = Array.from({ length: 120 }, (_, k) => `لفظ${k}`).join(' ');
    const words = say(`${story} عائشہ نے کیا صاف کیا؟ میزیں`, 0);
    const out = renderTurns(words);
    expect(out).toContain('عائشہ نے کیا صاف کیا؟');
    expect(out).toContain('میزیں');
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(560);
  });
});

describe('the begin line is matched without its stage directions', () => {
  const spec = IB.getTaskSpec({ grade: 3, set: 'A', task: 'ma.add1' });
  it('the bank line has a bracketed direction; beginLines drops it', () => {
    expect(JSON.stringify(spec.script.begin)).toMatch(/\[/);
    for (const l of C.beginLines(spec)) expect(l).not.toMatch(/[[\]]/);
  });
  it('the spoken line (without the bracket) gives a cue clock', () => {
    const words = [...say('کیا آپ تیار ہیں؟ یہاں سے شروع کریں', 0.5), ...say('چار سات آٹھ انیس', 4, 2, '2')];
    const c = C.findClock({ words, spec, firstItems: spec.items.slice(0, 3).map((x) => String(x.answer)) });
    expect(c.clock).toBe('cue');
    expect(c.begin_at_s).toBeLessThan(4);
  });
});

describe('an inferred clock never lands late in the note', () => {
  it('no cue, the first item-like word heard only at 65 s: the clock starts at the first word', () => {
    const spec = IB.getTaskSpec({ grade: 3, set: 'A', task: 'ma.add1' });
    const words = [...say('ٹھیک ہے بیٹا اب جلدی جلدی بتائیں', 0.6), ...say('کچھ کچھ آواز', 10, 2, '2'), ...say('4', 65.7, 0.3, '2')];
    const c = C.findClock({ words, spec, firstItems: ['4', '5'] });
    expect(c.clock).toBe('inferred');
    expect(c.begin_at_s).toBeLessThan(15);
  });
});
