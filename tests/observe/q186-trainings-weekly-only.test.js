'use strict';
/**
 * Queue #186 — training only in the coach's Weekly Report, and there ONE (the operator, 19 Nov 2026: "For all HITLs in
 * the Debrief Daily reports, there are training modules attached everywhere. We dont need that. We only need that in
 * the Weekly Report that gets sent to coaches. And we only want to recommend them ONE training.")
 *
 *   per debrief  the coach's (or principal's) Feedback Report after each debrief — the WhatsApp text card, the card
 *                image and its caption, the app's report page — names no Coach Training module. It is shared by every
 *                HITL rubric (FICO17 v6, FDE obs612, FICO-S): the judge scores the debrief, not the lesson rubric.
 *   per visit    (tests/coaching/video-reco/q186-hitl-no-clip.test.js) the teacher's HITL report carries no training clip.
 *   weekly       the Weekly Report names exactly one module, `training`: the focus's (the first behaviour, in the
 *                rubric's order, not yet done in 6 of her last 10 debriefs), else the top "keep in mind" miss's, else none.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const F = require('../../bot/shared/services/observe/observe-coach-feedback');
const Card = require('../../bot/shared/services/observe/observe-coach-card');
const { observeStrings } = require('../../bot/shared/services/observe/observe-strings');
const M = require('../../bot/shared/config/coach-training-modules');
const W = require('../../bot/shared/services/observe/coach-week');
const ReportSvc = require('../../dashboard/services/coach-report.service');
const WeekSvc = require('../../dashboard/services/coach-week.service');

const KEYS = ['opened_with_specific_praise', 'anchored_in_real_moment', 'asked_and_waited', 'one_improvement_only',
  'moves_not_teacher', 'elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step'];
const rub = (doneKeys, over = {}) => {
  const r = { disparaged_teacher: false };
  for (const k of KEYS) r[k] = doneKeys.includes(k);
  return { ...r, ...over };
};

// A debrief with three misses (own step, talked less, rehearsal); the judge's focus is the rehearsal.
const feedback = (over = {}) => ({
  praise_line: 'You opened with what really worked in the lesson.',
  wins: [
    { behaviour: 'Specific praise', evidence: 'you said "I liked how you used Manu the cat"' },
    { behaviour: 'Asked and waited', evidence: 'you asked "what was going through your mind?" and waited' },
  ],
  try: { move: 'Have the teacher say the question out loud', evidence: 'the talk ended once the plan was agreed', instead: 'say "show me how you will say it in class", then wait' },
  reflection_question: 'What stopped you from asking for a rehearsal today?',
  focus: 'rehearsed_the_step',
  focus_why: 'It was missed in most of your recent debriefs.',
  missed: { elicited_if_then: 'You gave the step yourself.', righting_reflex_held: 'You spoke for most of the talk.', rehearsed_the_step: 'The talk ended once the plan was agreed.' },
  did: { opened_with_specific_praise: 'You named the story.' },
  rubric: rub(['opened_with_specific_praise', 'anchored_in_real_moment', 'asked_and_waited', 'one_improvement_only', 'moves_not_teacher']),
  ...over,
});

// Everything a Coach Training module leaves on a page: its link, its number line, (English) any module title. Urdu module
// titles are not checked: Module 6's Urdu title is the behaviour's own Urdu name (استاد کا اپنا اگلا قدم), which the marks show.
function expectNoModule(text, lang) {
  expect(text).not.toContain('claude.ai/artifact');
  expect(text).not.toMatch(lang === 'ur' ? /ماڈیول/ : /Module \d/);
  expect(text).not.toMatch(lang === 'ur' ? /کوچ ٹریننگ/ : /Coach Training/);
  if (lang === 'en') for (const m of M.COACH_MODULES) expect(text).not.toContain(m.title.en);
}

describe('per debrief: the Feedback Report names no Coach Training module', () => {
  for (const lang of ['en', 'ur']) {
    const S = observeStrings(lang);

    test(`${lang}: the WhatsApp text card — marks, wins, misses, the one next focus; no module, no link`, () => {
      const card = F.renderCoachFeedbackMessages(feedback(), S)[1];
      expect(card).toContain(S.coach_card_try_label);
      expect(card).toContain('Have the teacher say the question out loud');
      expectNoModule(card, lang);
    });

    test(`${lang}: nothing missed (once the full-debrief capstone) still names no module`, () => {
      const card = F.renderCoachFeedbackMessages(feedback({ focus: null, rubric: rub(KEYS) }), S)[1];
      expectNoModule(card, lang);
    });

    // On staging/main the WhatsApp card does not draw the rubric (no marks label) and its caption has no module line;
    // the card image is pinned module-free all the same.
    test(`${lang}: the card image draws no module line`, () => {
      const html = Card.buildCoachCardHtml(feedback(), { lang, brand: 'niete' });
      expect(html).not.toContain('class="mod"');
      expectNoModule(html, lang);
    });
  }

  test('the app\'s report page: no module on any miss or on the next focus', () => {
    const r = ReportSvc.shapeCoachReport({
      id: '33333333-3333-4333-8333-333333333333', observer_user_id: 'coach', user_id: 'teacher', created_at: '2026-11-04T06:00:00Z',
      feedback: feedback(), feedback_at: '2026-11-04T06:42:00Z', topic: 'Journey to Taif', subject: 'Islamiyat', grade: '5', teacher_name: 'Ms. Sadia',
    });
    expect(r.missed.map((m) => m.key)).toEqual(['elicited_if_then', 'righting_reflex_held', 'rehearsed_the_step']);
    for (const m of r.missed) expect(m).not.toHaveProperty('module');
    expect(r.focus.key).toBe('rehearsed_the_step');
    expect(r.focus).not.toHaveProperty('module');
    expectNoModule(JSON.stringify(r), 'en');
  });
});

describe('weekly: exactly one training', () => {
  // PKT is UTC+5: 09:00 PKT = 04:00Z.
  const at = (date, hourPkt = 9) => new Date(Date.parse(`${date}T00:00:00Z`) + (hourPkt - 5) * 3600 * 1000).toISOString();
  const history = Array.from({ length: 10 }, (_, i) => ({
    at: at('2026-10-2' + (i % 5), 9 + i), rubric: rub(['opened_with_specific_praise', 'anchored_in_real_moment', 'moves_not_teacher', ...(i === 0 ? ['asked_and_waited'] : [])]),
  }));
  const day = (d, extra = []) => ({ at: at(d, 10), rubric: rub(['opened_with_specific_praise', 'moves_not_teacher', ...extra]) });
  const thisWeek = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => day(d, ['anchored_in_real_moment']));

  test('the focus\'s module, and no other: none on the misses to keep in mind, none on the focus itself', () => {
    const s = W.summariseWeek({ monday: '2026-11-02', thisWeek, lastWeek: history.slice(0, 9), before: history });
    expect(s.focus.key).toBe('asked_and_waited');
    expect(s.keepInMind.length).toBeGreaterThan(0);
    expect(s.training).toBe(M.BEHAVIOUR_MODULE.asked_and_waited);
    expect(s.focus).not.toHaveProperty('module');
    for (const k of s.keepInMind) expect(k).not.toHaveProperty('module');
  });

  test('no focus (every behaviour steady in her last 10): the top miss to keep in mind gives the one training', () => {
    const steady = Array.from({ length: 10 }, (_, i) => ({ at: at('2026-10-2' + (i % 5), 9 + i), rubric: rub(KEYS) }));
    const dip = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => ({
      at: at(d, 10), rubric: rub(KEYS.filter((k) => k !== 'righting_reflex_held' && k !== 'rehearsed_the_step')),
    }));
    const s = W.summariseWeek({ monday: '2026-11-02', thisWeek: dip, lastWeek: [], before: steady });
    expect(s.focus).toBeNull();
    expect(s.keepInMind.map((k) => k.key)).toEqual(['righting_reflex_held', 'rehearsed_the_step']);
    expect(s.training).toBe(M.BEHAVIOUR_MODULE.righting_reflex_held);
  });

  test('nothing to work on: no training', () => {
    const s = W.summariseWeek({ monday: '2026-11-02', thisWeek: [], lastWeek: [], before: [] });
    expect(s.training).toBeNull();
  });

  test('the page\'s week carries the one training and no second module (no "next" module either)', () => {
    const s = WeekSvc.shapeWeek(W.summariseWeek({ monday: '2026-11-02', thisWeek, lastWeek: history.slice(0, 9), before: history }));
    expect(s.training).toBe(M.BEHAVIOUR_MODULE.asked_and_waited);
    expect(s.focus).not.toHaveProperty('module');
    expect(s.focus).not.toHaveProperty('nextModule');
    for (const k of s.keepInMind) expect(k).not.toHaveProperty('module');
  });
});
