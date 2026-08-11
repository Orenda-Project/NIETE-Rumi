'use strict';
/**
 * bd-2358 — a child must never be shown the same option twice.
 *
 * From production, 2026-07-28. A Grade 5 Science electricity question rendered
 * its picker like this:
 *
 *     The flow of free electro          <- row title, cut mid-word
 *     The flow of free electrons        <- row description, the same string
 *
 * Meta caps a list row TITLE at 24 characters and truncates SILENTLY, which is
 * a real problem the 72-character DESCRIPTION exists to solve. The bug is that
 * the truncated fragment was kept ABOVE the full text instead of being replaced
 * by it, so every long option stutters. 3,071 of the 5,646 live list questions
 * do this today.
 *
 * A third surface compounds it: askBody() spells the full lettered options into
 * the message body whenever any label exceeds the TITLE cap, so the child reads
 * the options three times. Only 22 questions in the bank have an option too long
 * for the description, so that spell-out belongs at the DESCRIPTION cap.
 *
 * RUN: NODE_OPTIONS='--localstorage-file=/tmp/jest-ls.json' npx jest tests/quiz/video-quiz-sender.test.js
 */
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendImageWithButtons: jest.fn().mockResolvedValue(true),
  sendTextMessage: jest.fn().mockResolvedValue(true),
  sendImageMessage: jest.fn().mockResolvedValue(true),
  sendAudioFromUrlReturningId: jest.fn().mockResolvedValue('mid-1'),
  sendTextMessageReturningId: jest.fn().mockResolvedValue('mid-2'),
  sendFlow: jest.fn().mockResolvedValue(true),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const sender = require('../../shared/services/quiz/video-quiz-sender.service');
const render = require('../../shared/services/quiz/video-quiz-render.service');

const LONG = 'The flow of free electrons';        // 26 chars — over the title cap
const LONG2 = 'Electricity stored in cells';       // 27
const SHORT = 'A fuse wire melting';               // 19 — fits

/** The real production row behind the screenshot. */
function electricity(over = {}) {
  return {
    id: 'q-electric', external_id: 'q-electric',
    question_text: 'What is electric current?',
    option_a: LONG, option_b: LONG2, option_c: SHORT, option_d: null,
    correct_option: 'A',
    explanation: 'Electric current is the flow of free electrons.',
    option_feedback: null,
    media: {},
    render_pattern: 'P1',
    ...over,
  };
}

/** Send the interaction phase and return the rows WhatsApp actually received. */
async function rowsFor(q) {
  jest.clearAllMocks();
  const msgs = render.build(q);
  await sender.sendPhase('923000000000', msgs, 'interaction', { questionId: q.id });
  const call = WhatsAppService.sendInteractiveMessage.mock.calls[0];
  expect(call).toBeDefined();
  return call[1].action.sections[0].rows;
}

describe('bd-2358 — an option is never shown twice in one row', () => {
  test('no row description merely repeats its own truncated title', async () => {
    for (const row of await rowsFor(electricity())) {
      if (!row.description) continue;
      expect(row.description.startsWith(row.title)).toBe(false);
    }
  });

  test('the exact production case reads cleanly', async () => {
    const q = electricity();
    const shown = render.build(q).find((m) => m.role === 'ask').options;
    const rows = await rowsFor(q);
    const pos = shown.indexOf(LONG);
    expect(rows[pos].title).not.toBe('The flow of free electro');
    expect(rows[pos].description).toBe(LONG);
  });

  test('when any option is too long, every row uses a letter handle', async () => {
    // A mix of plain-text titles and letter handles in one list reads as broken.
    // If one option needs a handle they all take one, so the list stays uniform
    // and the letters line up with the body when the body is spelled out.
    const q = electricity();
    const shown = render.build(q).find((m) => m.role === 'ask').options;
    const rows = await rowsFor(q);
    expect(rows.map((r) => r.title)).toEqual(['A', 'B', 'C']);
    expect(rows.map((r) => r.description)).toEqual(shown);
    expect(new Set(shown)).toEqual(new Set([LONG, LONG2, SHORT]));
  });

  test('a list whose options all fit is left completely alone', async () => {
    // Four options, so this is a list rather than buttons, but every label is
    // inside the 24-char title cap — nothing here needs a handle.
    // Compared against the DISPLAY order, since bd-2359 shuffles it.
    const q = electricity({
      option_a: 'Copper', option_b: 'Rubber', option_c: 'Glass', option_d: 'Dry wood',
    });
    const shown = render.build(q).find((m) => m.role === 'ask').options;
    const rows = await rowsFor(q);
    expect(rows.map((r) => r.title)).toEqual(shown);
    expect(new Set(shown)).toEqual(new Set(['Copper', 'Rubber', 'Glass', 'Dry wood']));
    expect(rows.every((r) => r.description === undefined)).toBe(true);
  });

  test('an option longer than the description cap is still truncated, not dropped', async () => {
    const huge = 'x'.repeat(120);
    const q = electricity({ option_a: huge });
    const shown = render.build(q).find((m) => m.role === 'ask').options;
    const rows = await rowsFor(q);
    const pos = shown.indexOf(huge);
    expect(rows[pos].description).toHaveLength(render.LIST_ROW_DESCRIPTION_MAX);
    expect(huge.startsWith(rows[pos].description)).toBe(true);
  });

  test('row ids still carry the option index the scorer reads', async () => {
    const q = electricity();
    const a = render.build(q).find((m) => m.role === 'ask');
    const rows = await rowsFor(q);
    rows.forEach((row, pos) => {
      expect(render.parseAnswer(row.id))
        .toEqual({ questionId: 'q-electric', index: a.optionIndices[pos] });
    });
  });
});

describe('bd-2359 — the shuffle survives the trip through the sender', () => {
  // The render tests prove build() emits the right indices. This proves the
  // SENDER uses them, which is where the bug would actually live: it used to
  // derive every id from the row's position in the list.
  test('a shuffled list emits ids carrying the original index', async () => {
    for (const id of ['e2e-1', 'e2e-2', 'e2e-3', 'e2e-4', 'e2e-5']) {
      const q = electricity({ id, external_id: id });
      const msgs = render.build(q);
      const a = msgs.find((m) => m.role === 'ask');
      const rows = await rowsFor(q);
      rows.forEach((row, pos) => {
        expect(render.parseAnswer(row.id))
          .toEqual({ questionId: id, index: a.optionIndices[pos] });
      });
      // and the row a child reads as correct scores correct
      const correctPos = a.options.indexOf(LONG);
      expect(render.correctIndices(q))
        .toContain(render.parseAnswer(rows[correctPos].id).index);
    }
  });

  test('a shuffled buttons question emits ids carrying the original index', async () => {
    jest.clearAllMocks();
    const q = electricity({
      id: 'btn-1', external_id: 'btn-1', option_a: 'Copper', option_b: 'Rubber', option_c: 'Wood',
    });
    const msgs = render.build(q);
    const a = msgs.find((m) => m.role === 'ask');
    expect(a.kind).toBe('buttons');
    await sender.sendPhase('923000000000', msgs, 'interaction', { questionId: 'btn-1' });
    const { buttons } = WhatsAppService.sendInteractiveButtons.mock.calls[0][1];
    buttons.forEach((b, pos) => {
      expect(render.parseAnswer(b.id).index).toBe(a.optionIndices[pos]);
      expect(b.title).toBe(a.options[pos]);
    });
  });
});

describe('bd-2358 — the body spells options out only when the row cannot hold them', () => {
  const labels = [LONG, LONG2, SHORT];

  test('an option that fits the description is NOT repeated in the body', () => {
    // This is the third surface. Today the body letters these out as well, so
    // the child reads the same three options in the body, the row title and the
    // row description.
    expect(render.askBody('What is electric current?', labels, 'list', false))
      .toBe('What is electric current?');
  });

  test('an option too long for the description IS spelled out in the body', () => {
    const huge = 'y'.repeat(90);
    const body = render.askBody('Pick one', [huge, 'b', 'c'], 'list', false);
    expect(body).toContain('A. ' + huge);
    expect(body).toContain('Pick one');
  });

  test('a sound question keeps its listen prompt', () => {
    expect(render.askBody('Listen and tap.', ['s', 'p'], 'list', true))
      .toBe('Which one did you hear?');
  });
});
