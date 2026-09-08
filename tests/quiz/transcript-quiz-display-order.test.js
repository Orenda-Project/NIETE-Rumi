'use strict';
/**
 * ONE ORDER, STORED ONCE (round-5 D1).
 *
 * THE BUG THIS FILE EXISTS TO CATCH — the operator's own staging run, 2026-09-06.
 * A question card is a PICTURE with the options already lettered A/B/C on it, and
 * the child answers with three letter buttons underneath. The picture was drawn at
 * GENERATION time from a row that had an `external_id`; the buttons were built at
 * SEND time from a row re-selected WITHOUT one
 * (`video-quiz.service.js sendNextQuestion` / `handleAnswer`). The shuffle in
 * `video-quiz-render.service.js displayOrder()` is seeded on `external_id || id`,
 * so the two runs seeded on two different strings and produced two different
 * orders. The child taps the B on the picture, the button labelled B carries the
 * stored index of a different option, and the verdict praises an answer she never
 * gave ("That's right! Mummies were the preserved dead bodies…" after tapping
 * "coins").
 *
 * The fix is not "load external_id everywhere" — that is a rule nobody can enforce
 * on the next `.select()` someone writes. The display order is DECIDED ONCE at
 * generation and STORED on the row (`media.display_order`, display position →
 * stored index); every consumer reads it back. A row without one still falls back
 * to the seeded shuffle, so the 13k already-stored PK video rows behave exactly as
 * they did.
 *
 * RUN: node tests/run.js tests/quiz/transcript-quiz-display-order.test.js --forceExit
 */
const render = require('../../bot/shared/services/quiz/video-quiz-render.service');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');
const renderTeacherHtml = require('../../bot/shared/templates/transcript-quiz-teacher.template');

const QID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// The uuid the DB assigned this row. Seeding on it gives the exact REVERSE of the
// order seeding on the external_id gives — the divergence the operator hit. The
// guard test below asserts the two seeds really do disagree, so this file can
// never quietly become vacuous if the hash or the fixture changes.
const ROW_ID = '33333333-3333-4333-8333-333333333333';

/** One authored question in the shape `toRows` consumes. */
function authored(over = {}) {
  return {
    question: 'Which of these is a chemical change?',
    options: ['Ice melting', 'Iron rusting', 'Water boiling'],
    correct_index: 1,
    explanation: 'Rusting makes a new substance; melting and boiling do not.',
    option_feedback: { correct: 'That is right — rusting makes a new substance.', wrong: {} },
    slo_id: 'S2',
    level: 'understand',
    ...over,
  };
}

/** What `sendNextQuestion` actually hands the renderer: the stored row, no external_id. */
function asLoadedAtSendTime(row) {
  const {
    // eslint-disable-next-line camelcase
    external_id, quiz_id, ...rest
  } = row;
  return { id: ROW_ID, ...rest };
}

const ask = (msgs) => msgs.find((m) => m.role === 'ask' || m.role === 'picture_flow');

describe('D1 — the display order is decided at generation and stored on the row', () => {
  test('toRows stamps media.display_order as a permutation of the option indices', () => {
    const rows = Gen.toRows(QID, [authored()], { rng: () => 0 });
    const order = rows[0].media && rows[0].media.display_order;
    expect(Array.isArray(order)).toBe(true);
    expect([...order].sort()).toEqual([0, 1, 2]);
  });

  test('applyMedia carries the stored order through the render pass', () => {
    const qs = [authored()];
    const rows = Gen.applyMedia(Gen.toRows(QID, qs, { rng: () => 0 }), qs,
      { figureUrls: {}, cardUrls: {}, language: 'en' });
    expect(rows[0].media.display_order).toHaveLength(3);
    expect(rows[0].media.language).toBe('en');
  });

  test('the stored order is what displayOrder returns, even with the external_id gone', () => {
    const rows = Gen.toRows(QID, [authored()], { rng: () => 0 });
    const stored = rows[0].media.display_order;
    const atSendTime = asLoadedAtSendTime(rows[0]);
    const labels = render.optionLabels(atSendTime);
    expect(render.displayOrder(atSendTime, labels)).toEqual(stored);
  });

  test('the fixture really does make the two seeds disagree', () => {
    // Without this, a lucky uuid whose seeded shuffle happens to match the
    // external_id's would make the test below pass on the broken code.
    const row = Gen.toRows(QID, [authored()], { rng: () => 0 })[0];
    const labels = render.optionLabels(row);
    const bySeed = (q) => {
      const noStore = { ...q, media: { ...(q.media || {}), display_order: undefined } };
      return render.displayOrder(noStore, labels).join('');
    };
    expect(bySeed(row)).not.toBe(bySeed(asLoadedAtSendTime(row)));
  });

  test('THE MUMMIES BUG: the card the child looks at and the buttons she taps agree', () => {
    const rows = Gen.toRows(QID, [authored()], { rng: () => 0 });
    const row = rows[0];

    // What the CARD was drawn from, at generation, from the row that had its
    // external_id (transcript-quiz-generate.service.js renderCards).
    const cardLabels = render.optionLabels(row);
    const cardOrder = render.displayOrder(row, cardLabels);
    // The card prints A/B/C down the display order; this is what the child reads.
    const cardLetterToText = {};
    cardOrder.forEach((storedIdx, pos) => { cardLetterToText['ABC'[pos]] = cardLabels[storedIdx]; });

    // What the SENDER built, at send time, from the row as `sendNextQuestion`
    // loads it: no external_id.
    const a = ask(render.build(asLoadedAtSendTime(row)));
    const buttonLetterToStoredIdx = {};
    a.optionIndices.forEach((storedIdx, pos) => { buttonLetterToStoredIdx['ABC'[pos]] = storedIdx; });

    // Tap every letter the card shows and check the verdict would name that option.
    ['A', 'B', 'C'].forEach((letter) => {
      const tappedStoredIdx = buttonLetterToStoredIdx[letter];
      expect(cardLabels[tappedStoredIdx]).toBe(cardLetterToText[letter]);
    });
  });

  test('the teacher PDF lists the options in the same order the child sees', () => {
    const rows = Gen.toRows(QID, [authored()], { rng: () => 0 });
    const stored = rows[0].media.display_order;
    const html = renderTeacherHtml({
      topic: 'Chemical change', teacherName: 'Rifat Noor', grade: '6', date: '6 Sep 2026',
      link: 'https://example.test/q', language: 'en',
      digest: { topic: 'Chemical change', subject: 'science', slos: [{ id: 'S2', statement: 'tell a chemical change from a physical one', taught_level: 'understand' }] },
      questions: [asLoadedAtSendTime(rows[0])],
    });
    // The PDF prints the options in display order; the first one it prints must be
    // the option the child's card shows at A. `toRows` has already shuffled the
    // STORED order, so read the labels off the row rather than from the authored
    // list — an expectation written against the authored order tests nothing.
    const labels = render.optionLabels(rows[0]);
    const firstPrinted = labels
      .map((t) => [t, html.indexOf(t)]).filter(([, i]) => i >= 0)
      .sort((x, y) => x[1] - y[1])[0][0];
    expect(firstPrinted).toBe(labels[stored[0]]);
  });
});

describe('D1 — a bad or absent stored order never wins over a working fallback', () => {
  const base = {
    id: ROW_ID,
    question_text: 'Which of these is a chemical change?',
    option_a: 'Ice melting', option_b: 'Iron rusting', option_c: 'Water boiling',
    correct_option: 'B', option_feedback: null, render_pattern: 'P1',
  };
  const labels = render.optionLabels(base);
  const seeded = render.displayOrder({ ...base, media: {} }, labels);

  test.each([
    ['not an array', 'nope'],
    ['the wrong length', [0, 1]],
    ['a duplicate index', [0, 0, 1]],
    ['an out-of-range index', [0, 1, 3]],
    ['a non-integer', [0, 1, 2.5]],
  ])('%s falls back to the seeded shuffle', (_why, bad) => {
    expect(render.displayOrder({ ...base, media: { display_order: bad } }, labels)).toEqual(seeded);
  });

  test('an OLD transcript row (stored before display_order existed) still agrees, now that the send path loads external_id', () => {
    // Both halves of the fix matter. Rows already on staging carry no
    // display_order, so they fall back to the seeded shuffle — which only lands
    // on the card's order because `sendNextQuestion` and `handleAnswer` now
    // select `external_id`. This is the assertion behind "no backfill needed".
    const generated = Gen.toRows(QID, [authored()], { rng: () => 0 })[0];
    const oldRow = { ...generated, media: {} };            // as it sits in the DB today
    delete oldRow.media.display_order;
    const labels = render.optionLabels(oldRow);
    const cardOrder = render.displayOrder(oldRow, labels);  // what renderCards drew

    const { quiz_id: _q, ...loadedWithExternalId } = { ...oldRow, id: ROW_ID };
    expect(render.displayOrder(loadedWithExternalId, labels)).toEqual(cardOrder);
  });

  test('a PK video row with no stored order shuffles exactly as it did before', () => {
    // 13k live rows have no media.display_order and must not move.
    const leg = { ...base, external_id: 'leg:Grade5-Science:8', media: {} };
    expect(render.displayOrder(leg, labels)).toEqual([2, 0, 1]);
  });
});
