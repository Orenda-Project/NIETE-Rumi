/**
 * bd-s1oo0.21 (L16) — CHILD_TEST_PREFILL_MODE=strict|assist.
 *
 * strict (the default) is L6's rule: a mark below its bar arrives EMPTY.
 * assist: every field the AI produced a mark for arrives FILLED — NEVER-bar and hint-only fields and the
 * story's flagged words included — and a field below its bar is visibly marked "unsure, please check"
 * (one line per screen listing them, plus a tag on the field). A field the AI did not mark stays empty in
 * both modes. coach_marks/ai_marks keep CONTRACT §5's shape and the diff still records every change.
 *
 * Real: the planner, the renderer, the read-back, L5's real bars (scoring/thresholds.js). No I/O.
 */

const P = require('../../../bot/shared/services/child-test/check-flow/prefill');
const CheckFlow = require('../../../bot/shared/services/child-test/check-flow');
const { STRINGS } = require('../../../bot/shared/services/child-test/check-flow/strings');
const F = require('../L6/fixtures/ai-marks');

const items = CheckFlow.formItems('3', 'A');
const cp = (s) => [...String(s)].length;

function withMode(mode, fn) {
  const before = process.env.CHILD_TEST_PREFILL_MODE;
  if (mode == null) delete process.env.CHILD_TEST_PREFILL_MODE; else process.env.CHILD_TEST_PREFILL_MODE = mode;
  try { return fn(); } finally {
    if (before === undefined) delete process.env.CHILD_TEST_PREFILL_MODE; else process.env.CHILD_TEST_PREFILL_MODE = before;
  }
}
const render = (block, aiMarks, lang = 'en', mode = 'assist') => withMode(mode, () => P.renderScreen(block, { aiMarks, items, lang, child: { label: 'roll 14' }, aiStatus: 'scored' }).data);

/** What the coach posts when they accept every pre-fill: the screen's own *_i values, prefixed. */
function postedFrom(block, data, fills = {}) {
  const p = P.PREFIX[block];
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    const m = k.match(/^(.+)_i$/);
    if (m) out[`${p}${m[1]}`] = v;
  }
  if (block === 'maths') out[`${p}numc`] = data.numc_on;
  else { out[`${p}flag`] = data.flag_on; out[`${p}nwc`] = data.nwc_on; }
  return { ...out, ...fills };
}

describe('the mode switch', () => {
  test('default (unset, empty, or anything else) is strict; only "assist" turns assist on', () => {
    expect(CheckFlow.prefillMode({})).toBe('strict');
    expect(CheckFlow.prefillMode({ CHILD_TEST_PREFILL_MODE: '' })).toBe('strict');
    expect(CheckFlow.prefillMode({ CHILD_TEST_PREFILL_MODE: 'bogus' })).toBe('strict');
    expect(CheckFlow.prefillMode({ CHILD_TEST_PREFILL_MODE: ' Assist ' })).toBe('assist');
  });

  test('strict is today\'s rule: the Urdu story count (NEVER bar) arrives empty, nothing is marked unsure', () => {
    const d = render('urdu', F.urduConfident(), 'en', null);
    expect(d.wc_i).toBe('');
    expect(d.fs1_i).toBe('');
    expect(d.unsure_v).toBe(false);
    expect(d.unsure_line).toBe('');
  });
});

describe('assist: everything the AI marked arrives filled, the unsure ones flagged', () => {
  test('Urdu: the NEVER-bar story count, the flagged words, hint-only first sounds and a below-bar made-up word arrive filled', () => {
    const d = render('urdu', F.urduConfident());
    expect(d.wc_i).toBe('41');
    expect(d.wa_i).toBe('45');
    expect(d.wc_h).toBe(STRINGS.en.help_unsure);
    expect(d.flag_on).toEqual(['w4', 'w8', 'w10']);           // every flagged word pre-ticked
    expect([d.fs1_i, d.fs2_i, d.fs3_i, d.fs5_i]).toEqual(['correct', 'wrong', 'correct', 'correct']);
    expect(d.q3_i).toBe('none');                                // 0.4 < the 0.7 bar, but the AI said "no answer"
    expect(d.nw4_i).toBe('wrong');                              // 0.5 < the 0.65 bar
    expect(d.nw4_d).toContain(STRINGS.en.unsure_check);
    expect(d.nw4_t).toContain(STRINGS.en.unsure_tag);
    expect(d.q3_t).toContain(STRINGS.en.unsure_tag);
    expect(d.q1_t).not.toContain(STRINGS.en.unsure_tag);       // 0.9 clears the bar: not unsure
  });

  test('a field the AI did not mark stays empty in assist (no row, or confidence 0)', () => {
    const m = F.urduConfident();
    m.nonwords = m.nonwords.filter((n) => n.id !== 'u3A-nw5');
    const d = render('urdu', m);
    expect(d.fs4_i).toBe('');                                   // verdict none at confidence 0: assemble's "not scored"
    expect(d.nw5_i).toBe('');
    expect(render('urdu', null).wc_i).toBe('');
  });

  test('one line per screen lists the unsure items', () => {
    const d = render('urdu', F.urduConfident());
    expect(d.unsure_v).toBe(true);
    for (const piece of ['words correct', 'words read wrong', 'Q3', 'first sound 1', '«', 'Unsure']) expect(d.unsure_line).toContain(piece);
    expect(d.unsure_line).not.toContain('Q1');
  });

  test('maths: the NEVER-bar quick-sum count and a below-bar number arrive filled; an unread written sum stays empty', () => {
    const d = render('maths', F.mathsConfident());
    expect(d.qc_i).toBe('12');
    expect(d.qa_i).toBe('14');
    expect(d.qc_h).toBe(STRINGS.en.help_unsure);
    expect(d.n6_i).toBe('wrong');
    expect(d.w3_i).toBe('');                                    // unreadable at confidence 0
    expect(d.wp_i).toBe('correct');                             // 0.6 < 0.7, filled, unsure
    expect(d.unsure_line).toContain('quick sums');
  });

  test('a strip photo of the wrong form is not a mark: its written sums stay empty', () => {
    const m = F.mathsConfident();
    m.meta = { photo: { form_code: 'G5-A', form_code_ok: false, expected_code: 'G3-A' } };
    m.maths.written = m.maths.written.map((w) => ({ ...w, confidence: Math.min(w.confidence, 0.2) }));
    const d = render('maths', m);
    expect([d.w1_i, d.w2_i, d.w4_i]).toEqual(['', '', '']);
  });

  test('English: a confident story count is NOT marked unsure; the NEVER-bar made-up words are filled and unsure', () => {
    const d = render('english', F.englishConfident());
    expect(d.wc_i).toBe('17');
    expect(d.wc_h).toBe(STRINGS.en.help_filled);
    expect(d.nw1_i).toBe('correct');
    expect(d.nw1_d).toContain(STRINGS.en.unsure_check);
    expect(d.unsure_line).not.toContain('words correct');
  });
});

describe('assist: coach_marks, the diff and meta', () => {
  test('accepting every pre-fill saves the AI\'s verdicts with no edits; meta records mode, empty and unsure', () => {
    const ai = F.urduConfident();
    const d = render('urdu', ai);
    const posted = postedFrom('urdu', d, { u_fs4: 'none' });
    const r = withMode('assist', () => P.readScreen('urdu', posted, { aiMarks: ai, items, lang: 'en' }));
    expect(r.ok).toBe(true);
    expect(r.coachMarks.story.words_correct).toBe(41);
    expect(r.coachMarks.story.flagged.map((f) => f.idx)).toEqual([4, 8, 10]);
    expect(r.coachMarks.nonwords.map((n) => n.verdict)).toEqual(ai.nonwords.map((n) => n.verdict));
    expect(r.edits.filter((e) => !e.path.startsWith('first_sounds[u3A-fs4]'))).toEqual([]);
    expect(r.coachMarks.meta.prefill_mode).toBe('assist');
    expect(r.coachMarks.meta.shown_empty).toEqual(['first_sounds[u3A-fs4]']);
    expect(r.coachMarks.meta.shown_unsure).toEqual(expect.arrayContaining([
      'story.words_correct', 'story.flagged[4]', 'questions[u3A-q3]', 'first_sounds[u3A-fs1]', 'nonwords[u3A-nw4]',
    ]));
    expect(r.coachMarks.meta.shown_unsure).not.toContain('questions[u3A-q1]');
  });

  test('a coach correcting a pre-filled unsure mark is an edit', () => {
    const ai = F.urduConfident();
    const d = render('urdu', ai);
    const posted = postedFrom('urdu', d, { u_fs4: 'none', u_nw4: 'correct', u_wc: '38', u_flag: ['w4'] });
    const r = withMode('assist', () => P.readScreen('urdu', posted, { aiMarks: ai, items, lang: 'en' }));
    expect(r.ok).toBe(true);
    expect(r.edits).toEqual(expect.arrayContaining([
      { path: 'nonwords[u3A-nw4].verdict', ai: 'wrong', coach: 'correct' },
      { path: 'story.words_correct', ai: 41, coach: 38 },
      { path: 'story.flagged[8]', ai: 'skipped', coach: 'correct' },
    ]));
  });

  test('strict meta keeps its shape and adds the mode', () => {
    const ai = F.urduConfident();
    const d = render('urdu', ai, 'en', null);
    const posted = postedFrom('urdu', d, { u_wc: '41', u_wa: '45', u_q3: 'none', u_fs1: 'correct', u_fs2: 'wrong', u_fs3: 'correct', u_fs4: 'none', u_fs5: 'correct', u_nw4: 'wrong', u_nw5: 'correct', u_nw3: 'correct' });
    const r = withMode(null, () => P.readScreen('urdu', posted, { aiMarks: ai, items, lang: 'en' }));
    expect(r.ok).toBe(true);
    expect(r.coachMarks.meta.prefill_mode).toBe('strict');
    expect(r.coachMarks.meta.shown_unsure).toEqual([]);
    expect(r.coachMarks.meta.shown_empty).toContain('story.words_correct');
  });
});

describe('copy: catalog, both languages, WhatsApp caps in code points', () => {
  test.each(['ur', 'en'])('the unsure strings exist and fit (%s)', (lang) => {
    const S = STRINGS[lang];
    for (const k of ['help_unsure', 'unsure_check', 'unsure_tag', 'u_count', 'u_flags', 'u_fb', 'u_qs', 'u_wp']) expect(typeof S[k]).toBe('string');
    expect(cp(S.help_unsure)).toBeLessThanOrEqual(80);
    expect(cp(S.unsure_tag)).toBeLessThanOrEqual(10);
    for (const f of ['unsure_line', 'u_q', 'u_fs', 'u_nw', 'u_w']) expect(typeof S[f]).toBe('function');
  });

  test.each(['ur', 'en'])('every rendered assist label stays inside its cap (%s)', (lang) => {
    for (const [block, m] of [['urdu', F.urduConfident()], ['english', F.englishConfident()], ['maths', F.mathsConfident()]]) {
      const d = render(block, m, lang);
      for (const [k, v] of Object.entries(d)) {
        if (/_t$/.test(k)) expect(cp(v)).toBeLessThanOrEqual(30);
        if (/_h$/.test(k)) expect(cp(v)).toBeLessThanOrEqual(80);
        if (/_d$/.test(k)) expect(cp(v)).toBeLessThanOrEqual(300);
      }
      expect(cp(d.unsure_line)).toBeLessThanOrEqual(300);
    }
  });
});

describe('the Flow JSON: one unsure line per screen', () => {
  const { buildChildTestCheckFlow } = require('../../../bot/shared/services/child-test/check-flow/flow');
  const flow = buildChildTestCheckFlow();
  test.each(['URDU', 'ENGLISH', 'MATHS'])('%s shows ${data.unsure_line} when ${data.unsure_v}', (id) => {
    const screen = flow.screens.find((s) => s.id === id);
    const form = screen.layout.children.find((c) => c.type === 'Form');
    const line = form.children.find((c) => c.text === '${data.unsure_line}');
    expect(line).toMatchObject({ type: 'TextCaption', visible: '${data.unsure_v}' });
    expect(screen.data.unsure_line.type).toBe('string');
    expect(screen.data.unsure_v.type).toBe('boolean');
  });
});
