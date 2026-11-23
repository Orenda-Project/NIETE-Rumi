/**
 * The lesson plan check in a HITL debrief (the ICT HITL owner's spec "Lesson Plan Check: changes for Rumi", 23 Nov 2026):
 * the notes' last section, the five parts of the coach's plan talk judged separately (never scored), and the week's count.
 * Fixture: the spec's own example — 12 moves, 7 done, partner practice in We Do the first miss (about 18:40).
 */
const LP = require('../../bot/shared/services/observe/lp-check');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');

const move = (move_id, phase, verdict, text, extra = {}) => ({
  move_id, phase, bucket: 'must_happen', text, verdict, evidence: '', rationale: '', counted: verdict !== 'not_adjudicable', ...extra,
});

function specAnalysis(over = {}) {
  return {
    framework: 'fico17_v6',
    lp_fidelity: {
      status: 'ok',
      moderators: { note: '', plan_navigability: '' },
      moves: [
        move('m1', 'announce', 'executed', 'Tell children what they will learn today', { evidence: '[00:40] Today we will learn…' }),
        move('m2', 'recall', 'executed', 'Recall the last lesson by name', { evidence: '[01:10] Yesterday we read…' }),
        move('m3', 'explain', 'executed', 'Show first, then do it together, then children alone', { evidence: '[06:20] Watch me first…' }),
        move('m4', 'explain', 'executed', 'Explain common and proper nouns with examples', { evidence: '[08:05] Karachi is a proper noun…' }),
        move('m5', 'guided', 'executed', 'Children answer together and one by one', { evidence: '[14:30] All together…' }),
        move('m6', 'guided', 'not_done', 'Partner practice: sort the words', { rationale: 'Children answered the teacher instead of each other.' }),
        move('m7', 'guided', 'not_done', 'Class game: find the proper nouns in a sentence', { rationale: 'Not seen.' }),
        move('m8', 'independent', 'executed', 'Children write on their own', { evidence: '[24:00] Now write in your copy…' }),
        move('m9', 'independent', 'not_done', 'A different task for children who need it', { rationale: 'Every child had the same task.' }),
        move('m10', 'exit', 'partial', 'Ask "how do you know it is proper?"', { evidence: '[30:10] Is it common or proper?', rationale: 'Questions stayed "is it common or proper?"' }),
        move('m11', 'exit', 'not_done', 'Children say what they learnt', { rationale: 'The lesson ended with "did you understand?"' }),
        move('m12', 'homework', 'executed', "Set the plan's homework", { bucket: 'optional_extension', evidence: '[38:00] For homework…' }),
      ],
    },
    ...over,
  };
}

describe('planState — the plan and what was done, from the lesson-plan check', () => {
  it('groups every move under the five steps, in order, with done / total per step', () => {
    const s = LP.planState(specAnalysis());
    expect(s.state).toBe('ok');
    expect(s.steps.map((x) => x.key)).toEqual(['opening', 'explain', 'we_do', 'you_do', 'check']);
    expect(s.steps.map((x) => `${x.done}/${x.total}`)).toEqual(['2/2', '2/2', '1/3', '1/2', '1/3']);
    expect(`${s.done} of ${s.total}`).toBe('7 of 12');
  });

  it('marks a partly done move as missed (✓ done or ✗ missed), never as done', () => {
    const s = LP.planState(specAnalysis());
    const m10 = s.steps.find((x) => x.key === 'check').moves.find((m) => m.id === 'm10');
    expect(m10.mark).toBe('missed');
    expect(m10.partial).toBe(true);
  });

  it('done as planned is a done move with evidence; most missed is the first missed move, with its time when known', () => {
    const s = LP.planState(specAnalysis());
    expect(s.asPlanned).toEqual(expect.objectContaining({ id: 'm3', step: 'explain' }));
    expect(s.mostMissed).toEqual(expect.objectContaining({ id: 'm6', step: 'we_do' }));
  });

  it('a move not done at all has no moment in the recording: no time borrowed from another move; a partly done one keeps its own', () => {
    const s = LP.planState(specAnalysis());
    expect(s.mostMissed.time).toBeNull();
    const a = specAnalysis();
    a.lp_fidelity.moves[5] = { ...a.lp_fidelity.moves[5], verdict: 'partial', evidence: '[18:40] Now with your partner…' };
    a.lp_fidelity.moves[6] = { ...a.lp_fidelity.moves[6], verdict: 'executed', evidence: '[20:00] Game time' };
    a.lp_fidelity.moves[8] = { ...a.lp_fidelity.moves[8], verdict: 'executed', evidence: '[25:00] Group B…' };
    a.lp_fidelity.moves[10] = { ...a.lp_fidelity.moves[10], verdict: 'executed', evidence: '[36:00] Today I learnt…' };
    const p = LP.planState(a);
    expect(p.mostMissed).toEqual(expect.objectContaining({ id: 'm6', time: '18:40' }));
  });

  it('a move the check could not judge is "not assessed": shown, never counted as a miss', () => {
    const a = specAnalysis();
    a.lp_fidelity.moves[6] = { ...a.lp_fidelity.moves[6], verdict: 'not_adjudicable' };
    const s = LP.planState(a);
    expect(s.total).toBe(11);
    const m7 = s.steps.find((x) => x.key === 'we_do').moves.find((m) => m.id === 'm7');
    expect(m7.mark).toBe('not_assessed');
  });

  it('no plan linked: no lp_fidelity, or lp_absent', () => {
    expect(LP.planState({ framework: 'fico17_v6' }).state).toBe('no_plan');
    expect(LP.planState({ lp_fidelity: { status: 'lp_absent' } }).state).toBe('no_plan');
  });

  it('the plan was for a different lesson (lesson_mismatch) or the recording was unusable: not assessed, no checklist', () => {
    const mm = specAnalysis();
    mm.lp_fidelity.moderators.note = 'lesson_mismatch';
    expect(LP.planState(mm)).toEqual({ state: 'not_assessed', reason: 'mismatch' });
    const un = specAnalysis();
    un.lp_fidelity.moderators.note = 'recording_unusable';
    expect(LP.planState(un)).toEqual({ state: 'not_assessed', reason: 'recording' });
    expect(LP.planState({ lp_fidelity: { status: 'fidelity_unavailable' } })).toEqual({ state: 'not_assessed', reason: 'unavailable' });
  });
});

describe('the notes section (lp_check)', () => {
  const S = observeStrings('en');

  it('with no words from the model, the fallback still gives every move a label and exactly five lines', () => {
    const s = LP.planState(specAnalysis());
    const check = LP.buildLpCheck(s, LP.fallbackWords(s, 'en'));
    expect(check.state).toBe('ok');
    expect(check.lines).toHaveLength(5);
    expect(check.steps.flatMap((x) => x.moves).every((m) => m.label)).toBe(true);
    expect(check.lines[0]).toMatch(/We Do/);
  });

  it('keeps the model\'s words where it gave them, and the fallback\'s where it did not', () => {
    const s = LP.planState(specAnalysis());
    const words = LP.wordsFrom({
      moves: { m6: { label: 'Partner practice', what_happened: 'Children answered you instead of each other.' } },
      as_planned: 'Explain — showed first, did it together, then children tried alone.',
      most_missed: 'Children answered the teacher instead of each other.',
      lines: ['a', 'b', 'c', 'd', 'e'],
    }, s, 'en');
    const check = LP.buildLpCheck(s, words);
    const m6 = check.steps.find((x) => x.key === 'we_do').moves.find((m) => m.id === 'm6');
    expect(m6.label).toBe('Partner practice');
    expect(m6.what).toBe('Children answered you instead of each other.');
    const m1 = check.steps[0].moves[0];
    expect(m1.label).toBeTruthy();
    expect(check.lines).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('refuses five lines that carry a score, or not five lines, and falls back', () => {
    const s = LP.planState(specAnalysis());
    const scored = LP.wordsFrom({ lines: ['You did 7/12 moves', 'b', 'c', 'd', 'e'] }, s, 'en');
    expect(scored.lines[0]).not.toMatch(/7\/12/);
    const short = LP.wordsFrom({ lines: ['only one'] }, s, 'en');
    expect(short.lines).toHaveLength(5);
  });

  it('WhatsApp: the section comes last, with plan done, the checklist, the 5 lines with cues and the reminder', () => {
    const s = LP.planState(specAnalysis());
    const text = LP.renderLpCheckMessage(LP.buildLpCheck(s, LP.fallbackWords(s, 'en')), S);
    expect(text.startsWith('📘')).toBe(true);
    expect(text).toContain(S.lp_check_title);
    expect(text).toContain('7 of 12');
    expect(text).toMatch(/We Do 1\/3/);
    expect(text).toContain('✗');
    expect(text).toContain(S.guide_cue_wait);
    expect(text).toContain(S.guide_cue_name_it);
    expect(text).toContain(S.lp_check_reminder);
  });

  it('no plan linked: one question only', () => {
    const text = LP.renderLpCheckMessage(LP.buildLpCheck({ state: 'no_plan' }), S);
    expect(text).toContain(S.lp_no_plan_question);
    expect(text).not.toContain(S.lp_check_reminder);
  });

  it('every fixed word exists in English and Urdu', () => {
    const en = observeStrings('en');
    const ur = observeStrings('ur');
    for (const k of ['lp_check_title', 'lp_plan_done', 'lp_done_as_planned', 'lp_most_missed', 'lp_moves_label', 'lp_lines_label',
      'lp_check_reminder', 'lp_no_plan_question', 'lp_not_assessed_mismatch', 'lp_not_assessed_recording', 'lp_not_assessed_unavailable']) {
      expect(typeof en[k]).toBe('string');
      expect(ur[k]).not.toBe(en[k]);
    }
    for (const p of LP.PARTS) {
      expect(en.lp_part_names[p]).toBeTruthy();
      expect(ur.lp_part_names[p]).toBeTruthy();
      expect(ur.lp_part_names[p]).not.toBe(en.lp_part_names[p]);
    }
  });
});

describe('the five parts of the coach\'s plan talk — judged separately, never scored', () => {
  const check = () => {
    const s = LP.planState(specAnalysis());
    return LP.buildLpCheck(s, LP.fallbackWords(s, 'en'));
  };
  const transcript = 'Coach: Follow the lesson plan. Follow the lesson plan, okay? The plan was not followed. Teacher: Okay.';

  it('a recording that only says "Follow the lesson plan" gives 0 of 5, even if the model says otherwise', () => {
    const result = { parts: LP.PARTS.map((part) => ({ part, covered: true, quote: 'Follow the lesson plan', what_happened: null })) };
    const d = LP.discussionFrom(result, check(), transcript);
    expect(d.state).toBe('ok');
    expect(d.covered).toBe(0);
    expect(d.total).toBe(5);
  });

  it('no quote, not covered; a quote that is not in the recording, not covered', () => {
    const t = 'Coach: Let us look at the We Do step of today\'s plan. What made partner practice hard to do today? Teacher: The class was big.';
    const result = { parts: [
      { part: 'name_step', covered: true, quote: "Let us look at the We Do step of today's plan." },
      { part: 'as_planned', covered: true, quote: '' },
      { part: 'gap', covered: true, quote: 'At 18:40 the plan had partner practice and children answered you' },
      { part: 'ask', covered: true, quote: 'What made partner practice hard to do today?' },
      { part: 'next_step', covered: false, quote: '', what_happened: 'You gave the next step yourself.' },
    ] };
    const d = LP.discussionFrom(result, check(), t);
    expect(d.parts.map((p) => p.covered)).toEqual([true, false, false, true, false]);
    expect(d.covered).toBe(2);
    expect(d.parts[4].what).toBe('You gave the next step yourself.');
  });

  it('a judge that answers nothing usable is null (no block), never a crash', () => {
    expect(LP.discussionFrom(null, check(), transcript)).toBeNull();
    expect(LP.discussionFrom({ parts: 'x' }, check(), transcript)).toBeNull();
  });

  it('the prompt carries the plan, the transcript and the rule that general lines never count', () => {
    const p = LP.discussionPrompt(transcript, check(), 'en');
    expect(p).toContain('We Do');
    expect(p).toContain(transcript);
    expect(p).toMatch(/never cover any part/i);
  });

  it('judgeDiscussion: no plan linked → no_plan without a model call; not assessed → not_assessed; ok → the model\'s parts', async () => {
    const complete = jest.fn(async () => ({ result: { parts: LP.PARTS.map((part) => ({ part, covered: false, quote: '', what_happened: 'x' })) } }));
    expect(await LP.judgeDiscussion({ transcript, lpCheck: { v: 1, state: 'no_plan' }, lang: 'en' }, { complete })).toEqual({ v: 1, state: 'no_plan' });
    expect(await LP.judgeDiscussion({ transcript, lpCheck: { v: 1, state: 'not_assessed', reason: 'mismatch' }, lang: 'en' }, { complete }))
      .toEqual({ v: 1, state: 'not_assessed', reason: 'mismatch' });
    expect(complete).not.toHaveBeenCalled();
    const d = await LP.judgeDiscussion({ transcript, lpCheck: check(), lang: 'en' }, { complete });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(d.covered).toBe(0);
    expect(await LP.judgeDiscussion({ transcript, lpCheck: null, lang: 'en' }, { complete })).toBeNull();
  });

  it('a failed judge is null: the debrief report is written as before', async () => {
    const complete = jest.fn(async () => { throw new Error('timeout'); });
    expect(await LP.judgeDiscussion({ transcript, lpCheck: check(), lang: 'en' }, { complete })).toBeNull();
  });
});

describe('attachLpCheck — the notes get the section only for an observer on the HITL switch', () => {
  const session = { id: 's1', observer_user_id: 'u1', analysis_data: specAnalysis() };
  const guide = { intro: 'hi', conversation: ['1', '2', '3', '4', '5', '6'] };

  it('switch off: the notes are exactly as before, and no model call', async () => {
    const complete = jest.fn();
    const out = await LP.attachLpCheck(guide, session, 'en', { switchOn: async () => false, complete });
    expect(out).toBe(guide);
    expect(complete).not.toHaveBeenCalled();
  });

  it('switch on: lp_check is added after the six lines; a failed words call falls back', async () => {
    const complete = jest.fn(async () => { throw new Error('boom'); });
    const out = await LP.attachLpCheck(guide, session, 'en', { switchOn: async () => true, complete });
    expect(out.conversation).toEqual(guide.conversation);
    expect(out.lp_check.state).toBe('ok');
    expect(out.lp_check.lines).toHaveLength(5);
  });

  it('switch on, no plan linked: the one question, no model call', async () => {
    const complete = jest.fn();
    const out = await LP.attachLpCheck(guide, { ...session, analysis_data: { framework: 'fico17_v6' } }, 'ur', { switchOn: async () => true, complete });
    expect(out.lp_check).toEqual({ v: 1, state: 'no_plan' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('a guide written whole (the /observe2 brief, an FDE talk) gets nothing', async () => {
    const brief = { kind: 'observe2_brief', text: 'x' };
    expect(await LP.attachLpCheck(brief, session, 'en', { switchOn: async () => true, complete: jest.fn() })).toBe(brief);
  });
});

describe('summariseWeek — full discussions this week against last, the part missed most, no plan linked', () => {
  const ok = (coveredKeys) => ({ v: 1, state: 'ok', total: 5, covered: coveredKeys.length,
    parts: LP.PARTS.map((key) => ({ key, covered: coveredKeys.includes(key) })) });
  const all = LP.PARTS;

  it('counts full (5 of 5) out of the debriefs with a plan; no plan linked is counted apart, never a miss', () => {
    const w = LP.summariseWeek(
      [ok(all), ok(all), ok(['name_step', 'gap']), ok(['name_step']), { v: 1, state: 'no_plan' }, { v: 1, state: 'not_assessed', reason: 'mismatch' }, null],
      [ok(all), ok(['gap'])],
    );
    expect(w.week).toEqual({ full: 2, of: 4 });
    expect(w.last).toEqual({ full: 1, of: 2 });
    expect(w.noPlan).toBe(2);
    expect(w.mostMissed).toEqual({ key: 'as_planned', n: 2, of: 4 });
  });

  it('a week with no lesson plan check at all has no block', () => {
    expect(LP.summariseWeek([null, undefined, {}], [ok(all)])).toBeNull();
  });

  it('no last week with a check: last is null', () => {
    expect(LP.summariseWeek([ok(all)], []).last).toBeNull();
  });
});
