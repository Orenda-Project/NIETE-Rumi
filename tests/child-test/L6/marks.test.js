/**
 * Child test check Flow (bd-s1oo0.6) — what the coach posted becomes coach_marks (same shape as
 * ai_marks) plus coach_edits ({path, ai, coach} for every changed mark). The AI's marks are an input
 * only: they are never modified.
 *
 * Real: renderScreen → a posted payload built from what the screen showed → readScreen → diffMarks.
 */


const { renderScreen, readScreen, diffMarks } = require('../../../bot/shared/services/child-test/check-flow/prefill');
const { formItems } = require('../../../bot/shared/services/child-test/check-flow/items');
const F = require('./fixtures/ai-marks');

const items = formItems('3', 'A');
const child = { label: 'Roll 14 · Grade 3' };

/** What WhatsApp posts when the coach taps the footer without changing anything (init-values back). */
function untouched(block, aiMarks) {
  const { data } = renderScreen(block, { aiMarks, items, lang: 'en', child, aiStatus: 'scored' });
  const p = { urdu: 'u_', english: 'e_', maths: 'm_' }[block];
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    const m = k.match(/^(wc|wa|fl|fw|sw|qc|qa|wp|q\d|fs\d|nw\d|n\d|w\d)_i$/);
    if (m) out[`${p}${m[1]}`] = v;
  }
  if (data.flag_on) out[`${p}flag`] = data.flag_on;
  if (data.nwc_on) out[`${p}nwc`] = data.nwc_on;
  if (data.numc_on) out[`${p}numc`] = data.numc_on;
  return out;
}

describe('confirming without changes', () => {
  test('filling only the empty fields with the AI\'s own answers records no edits', () => {
    const ai = F.urduConfident();
    const posted = { ...untouched('urdu', ai), u_q3: 'none', u_fs1: 'correct', u_fs2: 'wrong', u_fs4: 'none', u_fs5: 'correct', u_nw4: 'wrong' };
    const r = readScreen('urdu', posted, { aiMarks: ai, items });
    expect(r.ok).toBe(true);
    // the low-confidence flag (w10) arrived unticked and was left unticked: the coach says "read right"
    expect(r.edits).toEqual([{ path: 'story.flagged[10]', ai: 'wrong', coach: 'correct' }]);
    expect(r.coachMarks.story.words_correct).toBe(41);
    expect(r.coachMarks.story.flagged.map((f) => f.idx)).toEqual([4, 8]);
    expect(r.coachMarks.meta.shown_empty).toEqual(expect.arrayContaining(['questions[u3A-q3]', 'first_sounds[u3A-fs1]', 'nonwords[u3A-nw4]']));
  });
});

describe('corrections become edits, path by path', () => {
  test('a changed count, an unticked word, a changed verdict and an unticked made-up word', () => {
    const ai = F.urduConfident();
    const before = JSON.stringify(ai);
    const posted = {
      ...untouched('urdu', ai),
      u_wc: '43', u_flag: ['w4', 'w10'], u_q2: 'correct', u_q3: 'none',
      u_fs1: 'correct', u_fs2: 'correct', u_fs4: 'none', u_fs5: 'correct', u_nw4: 'correct', u_nwc: [],
    };
    const r = readScreen('urdu', posted, { aiMarks: ai, items });
    expect(r.ok).toBe(true);
    expect(r.edits).toEqual(expect.arrayContaining([
      { path: 'story.words_correct', ai: 41, coach: 43 },
      { path: 'story.flagged[8]', ai: 'skipped', coach: 'correct' },
      { path: 'questions[u3A-q2].verdict', ai: 'wrong', coach: 'correct' },
      { path: 'first_sounds[u3A-fs2].verdict', ai: 'wrong', coach: 'correct' },
      { path: 'nonwords[u3A-nw2].verdict', ai: 'wrong', coach: 'correct' },
      { path: 'nonwords[u3A-nw4].verdict', ai: 'wrong', coach: 'correct' },
    ]));
    expect(r.edits).toHaveLength(6);
    expect(r.coachMarks.story.flagged.map((f) => [f.idx, f.verdict])).toEqual([[4, 'wrong'], [10, 'wrong']]);
    expect(r.coachMarks.version).toBe('coach-marks-v1');
    expect(r.coachMarks.questions.find((q) => q.id === 'u3A-q2')).toMatchObject({ verdict: 'correct', heard: 'پتھر' });
    expect(JSON.stringify(ai)).toBe(before);
  });

  test('maths: numbers chips, quick sums and a written answer', () => {
    const ai = F.mathsConfident();
    const posted = { ...untouched('maths', ai), m_numc: ['m3A-n8'], m_n6: 'correct', m_qc: '13', m_w3: 'unreadable', m_wp: 'correct', m_w2: 'correct' };
    const r = readScreen('maths', posted, { aiMarks: ai, items });
    expect(r.ok).toBe(true);
    expect(r.edits).toEqual(expect.arrayContaining([
      { path: 'maths.numbers[m3A-n3].verdict', ai: 'wrong', coach: 'correct' },
      { path: 'maths.numbers[m3A-n6].verdict', ai: 'wrong', coach: 'correct' },
      { path: 'maths.quick_sums.correct', ai: 12, coach: 13 },
      { path: 'maths.written[m3A-w2].verdict', ai: 'wrong', coach: 'correct' },
    ]));
    expect(r.edits).toHaveLength(4);
    expect(r.coachMarks.maths.numbers.find((n) => n.id === 'm3A-n8').verdict).toBe('none');
  });

  test('a fallback child: the letters and words counts', () => {
    const ai = F.urduFallback();
    const posted = { ...untouched('urdu', ai), u_fl: '8', u_q3: 'none', u_fs1: 'correct', u_fs2: 'wrong', u_fs4: 'none', u_fs5: 'correct', u_nw4: 'wrong' };
    const r = readScreen('urdu', posted, { aiMarks: ai, items });
    expect(r.ok).toBe(true);
    expect(r.edits).toEqual([{ path: 'fallback.letters.correct', ai: 7, coach: 8 }]);
    expect(r.coachMarks.story).toBeNull();
  });
});

describe('no AI marks: the coach marks everything, and every mark is recorded against null', () => {
  test('a block that failed to score', () => {
    const posted = { e_wc: '20', e_wa: '25', e_q1: 'correct', e_q2: 'wrong', e_sw: 'correct' };
    for (let i = 1; i <= 8; i += 1) posted[`e_nw${i}`] = i === 2 ? 'wrong' : 'correct';
    const r = readScreen('english', posted, { aiMarks: null, items });
    expect(r.ok).toBe(true);
    expect(r.coachMarks.story).toMatchObject({ words_correct: 20, words_attempted: 25, flagged: [] });
    expect(r.coachMarks.nonwords).toHaveLength(8);
    expect(r.edits).toEqual(expect.arrayContaining([
      { path: 'story.words_correct', ai: null, coach: 20 },
      { path: 'nonwords[e3A-nw2].verdict', ai: null, coach: 'wrong' },
    ]));
  });
});

describe('what the coach typed is checked before it is saved', () => {
  test('a count that is not a whole number, or more correct than tried, comes back with a message', () => {
    const ai = F.englishConfident();
    const r = readScreen('english', { ...untouched('english', ai), e_wc: '30', e_wa: '21', e_nw8: 'none' }, { aiMarks: ai, items });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors)).toEqual(['e_wc']);
    const r2 = readScreen('maths', { ...untouched('maths', F.mathsConfident()), m_qc: 'twelve', m_n6: 'wrong', m_w3: 'wrong', m_wp: 'correct' }, { aiMarks: F.mathsConfident(), items });
    expect(r2.ok).toBe(false);
    expect(Object.keys(r2.errors)).toEqual(['m_qc']);
  });

  test('an empty required verdict is refused', () => {
    const ai = F.urduConfident();
    const r = readScreen('urdu', { ...untouched('urdu', ai) }, { aiMarks: ai, items });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['u_fs1', 'u_fs2', 'u_fs4', 'u_fs5', 'u_nw4', 'u_q3']);
  });
});

describe('diffMarks', () => {
  test('identical marks have no edits', () => {
    expect(diffMarks('maths', F.mathsConfident(), F.mathsConfident())).toEqual([]);
  });
});
