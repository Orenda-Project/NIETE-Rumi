'use strict';
/**
 * Round 28 (switch sa_r28_letter_pick, SPEC v2.80, O-46): a letter-sound picker the coach ends before every item was
 * presented (coach_end, or end_section) is unrated with unrated_why 'ended': the items not presented are the ones the
 * child was most likely to miss, so correct of presented is not the 10-item score the band is built on. The marks keep
 * correct, presented, of_all and attempted. Unchanged: 10 answered then an end is rated; a lost clip (9 presented,
 * complete) is rated on 9; 0 answered is unrated by the under-6 rule. Switch OFF: no unrated_why ever.
 * Fixtures are synthetic.
 */
const core = require('../sa/sa-core');

const TARGETS = ['ب', 'م', 'ک', 'س', 'ر', 'ج', 'د', 'ت', 'پ', 'ن'];
const POOL = ['ب', 'پ', 'ت', 'ٹ', 'ث', 'ن', 'م', 'ک', 'س', 'ر', 'ج', 'د'];

function opts(target, i) {
  const rest = POOL.filter((x) => x !== target).slice(0, 4);
  rest.splice(i % 5, 0, target);
  return rest;
}
function pickTask(practice) {
  const id = 'ur.letter_pick10';
  return {
    id, w3: true, r28: 'letter_pick', replaces: 'ur.letter_sounds5', kind: 'pick', response: 'tap',
    subtask: 'letter_sound_identification', lang: 'ur', title: { en: 'Listen and pick', ur: 'سنیں اور چنیں' }, time_limit_s: null,
    stop: {}, replay_at_s: 10, next_at_s: 15,
    instruction: { text: 'instruction', audio: 'sa/v5/ur/lp_intro.mp3' }, script: {}, coach_text: { text: 'coach', src: 'fixture' },
    items: TARGETS.map((target, i) => ({ id: `${id}.${String(i + 1).padStart(2, '0')}`, options: opts(target, i), target, prompt_audio: `sa/v5/ur/ls_${i + 1}.mp3`, prompt_text: 'x', src: 'fixture' })),
    practice: practice ? [{ id: `${id}.p2`, role: 'practice', options: opts('ٹ', 2), target: 'ٹ', prompt_audio: 'sa/v5/ur/ls_p2.mp3', prompt_text: 'p2' }] : [],
  };
}
function runner(o) {
  o = o || {};
  const battery = {
    battery_id: 'r28e',
    ui: o.flag === false ? {} : { r28_letter_pick: true },
    tasks: [pickTask(!!o.practice), { id: 'ma.after', mode: 'tap', items: [{ id: 'a1', target: '1', options: ['1', '2'] }] }],
  };
  let clock = 0;
  const r = core.createRunner({ battery, now: () => (clock += 100), onEvent: () => {}, manual: true, end_section: true });
  return r;
}
function running(o) {
  const r = runner(o);
  r.start(); r.instructionDone(); r.begin();
  return r;
}
function answerN(r, n) {
  for (let i = 0; i < n; i++) r.answer(r.view().item.target);
}
const pick = (r) => r.results().find((x) => x.task_id === 'ur.letter_pick10');

describe('O-46: a picker the coach ends early is not rated (sa_r28_letter_pick ON)', () => {
  test('(1) 7 answered, 7 right, then endSection(): unrated, why ended; the marks are kept', () => {
    const r = running();
    answerN(r, 7);
    expect(r.endSection()).toBe(true);
    const res = pick(r);
    console.log('case 1', JSON.stringify({ stop_reason: res.stop_reason, unrated: res.unrated, unrated_why: res.unrated_why, presented: res.presented, of_all: res.of_all }));
    expect(res).toMatchObject({ stop_reason: 'end_section', correct: 7, attempted: 7, presented: 7, of_all: 10, unrated: true, unrated_why: 'ended' });
  });

  test('(2) coachEnd() at 9 answered: unrated, why ended', () => {
    const r = running();
    answerN(r, 9);
    r.coachEnd();
    const res = pick(r);
    console.log('case 2', JSON.stringify({ stop_reason: res.stop_reason, unrated: res.unrated, unrated_why: res.unrated_why, presented: res.presented }));
    expect(res).toMatchObject({ stop_reason: 'coach_end', correct: 9, presented: 9, of_all: 10, unrated: true, unrated_why: 'ended' });
  });

  test('(3) unchanged: 10 answered, then the coach ends the section: rated (the task had already completed)', () => {
    const r = running();
    answerN(r, 10);
    r.endSection();
    const res = pick(r);
    console.log('case 3', JSON.stringify({ stop_reason: res.stop_reason, unrated: res.unrated, presented: res.presented }));
    expect(res).toMatchObject({ correct: 10, presented: 10, of_all: 10 });
    expect(res).not.toHaveProperty('unrated');
    expect(res).not.toHaveProperty('unrated_why');
  });

  test('(4) unchanged: a lost clip, 9 presented, complete: rated on 9', () => {
    const r = running();
    answerN(r, 7);
    expect(r.clipLost(r.view().item.id, 'prompt')).toBe(true);
    answerN(r, 2);
    const res = pick(r);
    console.log('case 4', JSON.stringify({ stop_reason: res.stop_reason, unrated: res.unrated, presented: res.presented }));
    expect(res).toMatchObject({ stop_reason: 'complete', correct: 9, presented: 9, unavailable: 1, of_all: 10 });
    expect(res).not.toHaveProperty('unrated');
    expect(res).not.toHaveProperty('unrated_why');
  });

  test('(4b) unchanged: lost clips leave 5 presented, complete: unrated by the under-6 rule, no unrated_why', () => {
    const r = running();
    for (let i = 0; i < 10; i++) { if (i % 2) r.clipLost(r.view().item.id, 'prompt'); else r.answer(r.view().item.target); }
    const res = pick(r);
    expect(res).toMatchObject({ stop_reason: 'complete', presented: 5, unavailable: 5, of_all: 10, unrated: true });
    expect(res).not.toHaveProperty('unrated_why');
  });

  test('(5) endSection() on the practice phase, 0 answered: unrated (also ended)', () => {
    const r = runner({ practice: true });
    r.start(); r.instructionDone();
    console.log('case 5 phase', r.view().phase);
    expect(r.endSection()).toBe(true);
    const res = pick(r);
    console.log('case 5', JSON.stringify({ stop_reason: res.stop_reason, unrated: res.unrated, unrated_why: res.unrated_why, presented: res.presented }));
    expect(res).toMatchObject({ stop_reason: 'end_section', presented: 0, of_all: 10, unrated: true, unrated_why: 'ended' });
  });

  test('switch OFF: an ended picker gets no unrated_why (OFF identity)', () => {
    const r = running({ flag: false });
    answerN(r, 7);
    r.endSection();
    const res = pick(r);
    expect(res).not.toHaveProperty('unrated_why');
    expect(res).not.toHaveProperty('unrated');
  });
});
