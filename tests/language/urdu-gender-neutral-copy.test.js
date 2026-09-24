'use strict';
/**
 * Urdu copy the teacher, the coach or the child READS never guesses their
 * gender.
 *
 * Urdu marks the subject's gender on most verb forms. «کیا آپ … شامل کرنا
 * چاہیں گے؟» has already decided the teacher is a man; «چاہیں گی» would decide
 * she is a woman — the same mistake. The so-called respectful plural
 * («آپ کرتے ہیں») is the masculine, not a neutral form. The neutral forms carry
 * no gender at all: the آپ-imperative or subjunctive («بھیجیں»، «کیا … شامل
 * کریں؟»), a passive or impersonal form («آپ کو دکھایا جائے گا»), or a verb that
 * agrees with a noun («آپ کی رجسٹریشن ہو گئی»).
 *
 * The checks are the two the quiz lane already measured and trusts:
 *   - addressForms (transcript-quiz-address.js) — آپ as the subject of a
 *     gendered verb, or a subjectless future spoken to آپ;
 *   - genderedTeacherForms (transcript-quiz-pedagogy.js) — a teacher noun
 *     (استاد / ٹیچر / معلم) with a gendered verb about them.
 *
 * Each surface is read through the function that serves it — the catalog
 * through resolveUx, the observe copy through observeStrings(), the coaching
 * card through getCoachingCardCopy(), the list through buildLPSelectionList() —
 * never by grepping a source file.
 */

const { UX_STRINGS, resolveUx } = require('../../bot/shared/config/ux-strings');
const { addressForms } = require('../../bot/shared/services/quiz/transcript-quiz-address');
const { genderedTeacherForms } = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy');

const gendered = (s) => [...addressForms(s, { kind: 'explanation' }), ...genderedTeacherForms(s, 'ur')];

describe('the ux catalog — every Urdu string is gender-neutral toward the reader', () => {
  const urKeys = Object.keys(UX_STRINGS).filter((k) => UX_STRINGS[k] && typeof UX_STRINGS[k].ur === 'string');

  test('the catalog is non-trivial (the walk reads real entries)', () => {
    expect(urKeys.length).toBeGreaterThan(500);
  });

  test('no catalog string addresses the teacher, coach or child with a gendered verb', () => {
    // The raw template: a {placeholder} is data the caller fills, not a verb.
    const hits = urKeys
      .map((k) => [k, gendered(UX_STRINGS[k].ur)])
      .filter(([, forms]) => forms.length);
    expect(hits).toEqual([]);
  });

  // The two the operator approved by name, and the rest of the sweep: each is
  // pinned so a later edit cannot quietly put the masculine back.
  test.each([
    ['coachingPhotoOffer', /چاہیں گے/],
    ['rosterFlowBody', /دیکھ سکیں گے/],
    ['uptakeLineHandOver', /بڑھائیں گے/],
    ['classSubjectsHeading', /پڑھاتے ہیں/],
    ['classRosterAction', /چاہتے ہیں/],
    ['classFlowBody', /پڑھاتے ہیں/],
    // A tier that does not carry a feature does not carry its keys (staging has no
    // uptake loop or class Flow yet): pin only the strings this catalog has.
  ].filter(([key]) => UX_STRINGS[key]))('%s no longer says the masculine form', (key, masculine) => {
    const s = resolveUx(key, { language: 'ur', params: { class: 'جماعت 4' } });
    expect(s).not.toMatch(masculine);
    expect(gendered(s)).toEqual([]);
  });

  test('coachingPhotoOffer still asks one yes/no question, in Urdu, under the body cap', () => {
    const s = UX_STRINGS.coachingPhotoOffer.ur;
    expect(s.startsWith('📸')).toBe(true);
    expect(s).toMatch(/تصاویر/);
    expect(s).toMatch(/؟/);
    expect([...s].length).toBeLessThanOrEqual(1024);
  });
});

describe('the observe copy the COACH reads (observeStrings("ur"))', () => {
  const { observeStrings, buildVisitCapturePrompt } = require('../../bot/shared/services/observe/observe-strings');
  const ur = observeStrings('ur');

  test.each([
    ['onboard_why', /آپ جاتے ہیں|بھروسہ کرتے ہیں/],
    ['debrief_choice_body', /کریں گے/],
    ['debrief_record_instruction', /دیکھیں گے/],
    ['send_choice_body', /دیکھیں گے/],
    ['leader_registered_welcome', /رجسٹر ہو گئے/],
  ])('%s is gender-neutral', (key, masculine) => {
    expect(typeof ur[key]).toBe('string');
    expect(ur[key]).not.toMatch(masculine);
    expect(gendered(ur[key])).toEqual([]);
  });

  test('the visit-capture prompt with a teacher named does not say «آپ … کر رہے ہیں»', () => {
    const s = buildVisitCapturePrompt('ur', { teacherName: 'علی', framework: 'fico' });
    expect(s).not.toMatch(/کر رہے ہیں/);
    expect(s).toContain('علی');
    expect(gendered(s)).toEqual([]);
  });
});

describe('the coaching flow the TEACHER reads', () => {
  test('the commitment question on the coaching card', () => {
    const { getCoachingCardCopy } = require('../../bot/shared/config/coaching-card.config');
    const s = getCoachingCardCopy('ur').commitPrompt;
    expect(s).not.toMatch(/کریں گے/);
    expect(s).toMatch(/عہد/);        // the QA runner's commitment-card pattern keys on it
    expect(s).toMatch(/آزمانے/);
    expect(gendered(s)).toEqual([]);
  });

  test('the duplicate-recording reply', () => {
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    const s = getCoachingMessage('duplicateRecording', 'ur');
    expect(s).not.toMatch(/چاہتے ہوں/);
    expect(gendered(s)).toEqual([]);
  });

  test('the "link a lesson plan" list body', () => {
    const { buildLPSelectionList } = require('../../bot/shared/services/coaching/lp-coaching/lp-selection-list.service');
    // One recent plan, so the LIST is built (no plans → the yes/no fallback).
    const recent = [{ id: 'lp-1', topic: 'کسر', grade: '4', subject: 'Math', created_at: new Date().toISOString() }];
    const out = buildLPSelectionList('sess-1', recent, 'ur');
    expect(out.type).toBe('list');
    const s = out.listData.body.text;
    expect(s).not.toMatch(/چاہیں گے/);
    expect(gendered(s)).toEqual([]);
    expect([...s].length).toBeLessThanOrEqual(1024);
  });
});
