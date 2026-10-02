/**
 * Child test check Flow (bd-s1oo0.6) — what each screen arrives with, built from a block's ai_marks.
 *
 * The rule the whole check rests on: a mark the model is confident about arrives filled in (the
 * coach just confirms it); a mark below its bar (scoring/thresholds.js) arrives EMPTY and is required,
 * so the coach has to mark it from what they heard. Words and items the model heard wrong arrive as
 * pre-ticked chips (untick = read right), at most 20.
 *
 * Real: the payload builder, the bars, the item bank (the committed bank, read through item-bank.js).
 */
const { renderScreen, MAX_CHIPS } = require('../../../bot/shared/services/child-test/check-flow/prefill');
const { formItems } = require('../../../bot/shared/services/child-test/check-flow/items');
const itemBank = require('../../../bot/shared/services/child-test/item-bank');
const F = require('./fixtures/ai-marks');

const items = formItems('3', 'A');
const child = { label: 'Roll 14 · Grade 3' };
const render = (block, aiMarks, extra = {}) => renderScreen(block, { aiMarks, items, lang: 'ur', child, aiStatus: aiMarks ? 'scored' : null, ...extra });

describe('the item bank reader', () => {
  test('reads the form from L1\'s item bank; a grade or form the bank does not have is null', () => {
    expect(items).toBe(itemBank.getForm('3', 'A'));
    expect(items.urdu.questions.map((q) => q.id)).toEqual(['u3A-q1', 'u3A-q2', 'u3A-q3']);
    expect(formItems('9', 'Z')).toBeNull();
    expect(formItems('3', 'Z')).toBeNull();
  });
});

describe('URDU: confident marks arrive filled, unsure ones empty', () => {
  const { screen, data } = render('urdu', F.urduConfident());

  test('opens on the URDU screen with the child by roll number and Urdu labels', () => {
    expect(screen).toBe('URDU');
    expect(data.child_line).toBe('Roll 14 · Grade 3');
    expect(data.t_wc).toBe('درست الفاظ');
    expect(data.verdicts.map((v) => v.id)).toEqual(['correct', 'wrong', 'none']);
  });

  test('a confident story count is pre-filled', () => {
    expect(data).toMatchObject({ story_v: true, fb_v: false, wc_i: '41', wa_i: '45' });
  });

  test('flagged words are chips; only the confident ones arrive ticked', () => {
    expect(data.flag_v).toBe(true);
    expect(data.flag_opts).toEqual([
      { id: 'w4', title: 'والد' }, { id: 'w8', title: 'گیا' }, { id: 'w10', title: 'کشتی' },
    ]);
    expect(data.flag_on).toEqual(['w4', 'w8']);
    expect(data.sw_v).toBe(false);
  });

  test('a confident comprehension verdict is pre-selected; an unsure one arrives empty', () => {
    expect(data.q1_i).toBe('correct');
    expect(data.q2_i).toBe('wrong');
    expect(data.q3_i).toBe('');
    expect(data.q1_d).toContain(items.urdu.questions[0].prompt);
    expect(data.q1_d).toContain('والد کے ساتھ');
    expect(data.q3_v).toBe(true);
  });

  test('first sounds: the hint is shown, and pre-selected only when confident', () => {
    expect(data.fs_sec_v).toBe(true);
    expect(data.fs1_i).toBe('');
    expect(data.fs3_i).toBe('correct');
    expect(data.fs1_t).toContain('مچھلی');
    expect(data.fs1_d).toContain('م');
  });

  test('made-up words: confident items are chips (wrong ones ticked); unsure ones get an empty radio', () => {
    expect(data.nwc_v).toBe(true);
    expect(data.nwc_opts.map((o) => o.id)).toEqual(['u3A-nw1', 'u3A-nw2', 'u3A-nw3', 'u3A-nw5']);
    expect(data.nwc_on).toEqual(['u3A-nw2']);
    expect(data.nw4_v).toBe(true);
    expect(data.nw4_i).toBe('');
    // chip items keep their radio hidden but carrying the AI verdict, so `required` never blocks on it
    expect(data.nw2_v).toBe(false);
    expect(data.nw2_i).toBe('wrong');
    // slots past the form's five words are hidden and pre-set
    expect(data.nw6_v).toBe(false);
    expect(data.nw6_i).toBe('none');
  });
});

describe('below the bar the counts arrive empty', () => {
  test('an unsure story count is empty (required in the Flow)', () => {
    const { data } = render('urdu', F.urduUnsureStory());
    expect(data.wc_i).toBe('');
    expect(data.wa_i).toBe('');
    expect(data.wc_h).toBe('ریکارڈنگ میں واضح نہیں۔ اپنی گنتی لکھیں');
  });
});

describe('the fallback (letters and words instead of the story)', () => {
  test('shows the two counts, hides the story and pre-sets its hidden counts to 0', () => {
    const { data } = render('urdu', F.urduFallback());
    expect(data).toMatchObject({ story_v: false, fb_v: true, fl_i: '7', fw_i: '4', wc_i: '0', wa_i: '0', flag_v: false, sw_v: false });
  });
});

describe('at most 20 chips', () => {
  test('a long list keeps the 20 most confident, in reading order', () => {
    const m = F.urduConfident();
    m.story.flagged = Array.from({ length: 30 }, (_, i) => ({ idx: i, word: `w${i}`, verdict: 'wrong', confidence: i / 30 }));
    const { data } = render('urdu', m);
    expect(MAX_CHIPS).toBe(20);
    expect(data.flag_opts).toHaveLength(20);
    expect(data.flag_opts[0].id).toBe('w10');
    expect(data.flag_opts[19].id).toBe('w29');
  });

  test('exactly one flagged word is a single radio, not a one-chip selector', () => {
    const m = F.urduConfident();
    m.story.flagged = [{ idx: 4, word: 'والد', verdict: 'wrong', confidence: 0.3 }];
    const { data } = render('urdu', m);
    expect(data.flag_v).toBe(false);
    expect(data.sw_v).toBe(true);
    expect(data.sw_i).toBe('');
    expect(data.sw_t).toContain('والد');
  });
});

describe('ENGLISH', () => {
  test('two questions, eight made-up words, no first sounds; English labels for an English coach', () => {
    const { screen, data } = renderScreen('english', { aiMarks: F.englishConfident(), items, lang: 'en', child, aiStatus: 'scored' });
    expect(screen).toBe('ENGLISH');
    expect(data.t_wc).toBe('Words correct');
    expect(data.q3_v).toBe(false);
    expect(data.fs_sec_v).toBeUndefined();
    expect(data.fs1_t).toBeUndefined();
    expect(data.nwc_opts).toHaveLength(7);
    expect(data.nwc_on).toEqual(['e3A-nw2', 'e3A-nw5']);
    expect(data.nw8_v).toBe(true);
    expect(data.nw8_i).toBe('');
  });
});

describe('MATHS', () => {
  const { screen, data } = render('maths', F.mathsConfident());
  test('numbers: confident ones are chips, the unsure one an empty radio', () => {
    expect(screen).toBe('MATHS');
    const confidentNumbers = items.maths.numbers.filter((n) => n.id !== 'm3A-n6').map((n) => String(n.value));
    expect(data.numc_opts.map((o) => o.title)).toEqual(confidentNumbers);
    expect(data.numc_on).toEqual(['m3A-n3', 'm3A-n8']);
    expect(data.n6_v).toBe(true);
    expect(data.n6_i).toBe('');
  });
  test('quick sums pre-filled; written answers read from the photo, unsure ones empty', () => {
    expect(data).toMatchObject({ qc_i: '12', qa_i: '14' });
    expect(data.w1_t).toBe('34 + 28');
    expect(data.w1_d).toContain('62');
    expect(data.w1_i).toBe('correct');
    expect(data.w2_i).toBe('wrong');
    expect(data.w3_i).toBe('');
    expect(data.w4_i).toBe('blank');
    expect(data.wverdicts.map((v) => v.id)).toEqual(['correct', 'wrong', 'blank', 'unreadable']);
    expect(data.wp_i).toBe('');
    expect(data.wp_d).toContain(items.maths.word_problem.prompt_ur);
  });
});

describe('no marks yet, or marking failed: every field arrives empty, and the line says which', () => {
  test('failed', () => {
    const { data } = render('urdu', null, { aiStatus: 'failed' });
    expect(data).toMatchObject({ wc_i: '', wa_i: '', q1_i: '', fs1_i: '', nw1_i: '', nw1_v: true, nwc_v: false, flag_v: false });
    expect(data.status_line).toBe('یہ ریکارڈنگ جانچی نہیں جا سکی۔ ہر خانہ اپنے سنے ہوئے کے مطابق بھریں۔');
  });
  test('still marking', () => {
    const { data } = render('maths', null, { aiStatus: 'pending' });
    expect(data.status_line).toContain('ابھی');
    expect(data.qc_i).toBe('');
  });
});

describe('reopening after a save shows the coach\'s own marks', () => {
  test('coach_marks win over ai_marks and arrive filled', () => {
    const ai = F.urduConfident();
    const coach = JSON.parse(JSON.stringify(ai));
    coach.story.words_correct = 43;
    coach.story.flagged = [ai.story.flagged[0]];
    coach.questions[2].verdict = 'wrong';
    const { data } = renderScreen('urdu', { aiMarks: ai, coachMarks: coach, items, lang: 'ur', child, aiStatus: 'scored' });
    expect(data.wc_i).toBe('43');
    expect(data.flag_opts.map((o) => o.id)).toEqual(['w4', 'w8', 'w10']);
    expect(data.flag_on).toEqual(['w4']);
    expect(data.q3_i).toBe('wrong');
  });
});
