/**
 * bd-snkn32.48 — a 6–12 teacher's own plan ends with "Before they write": the success criteria read aloud (the plan's
 * own "You can …" objectives) and a thumbs up / sideways / down self-prediction, so the shelf reviewer's 5D can pass.
 * Pure: added after the gates accept the rewrite, in a block the v9 schema already has (key_points).
 */

const {
  addCloseStep, conclusionWords, CLOSE_TITLE, CLOSE_TITLE_UR, THUMBS_LINE, THUMBS_LINE_UR, SHORT_LINE, SHORT_LINE_UR, CONCLUSION_MAX_WORDS,
} = require('../../bot/shared/services/lp612-own-close');

const doc = (over = {}) => ({
  schema_version: '3.0',
  provenance: { medium: 'en', subject: 'Physics' },
  objectives: { items: [{ text: 'You can tell rotatory from vibratory motion.' }, { text: 'You can sort motion by path.' }] },
  sections: [
    { id: 'introduction', blocks: [] },
    { id: 'conclusion', exit_ticket: [{ ref: 'X1', q: 'q', a: 'a' }], blocks: [{ type: 'board', text: 'b' }] },
  ],
  ...over,
});
const closeOf = (d) => d.sections.find((s) => s.id === 'conclusion');

describe('addCloseStep', () => {
  test('adds one key_points block last in the conclusion blocks (printed above the board question and exit ticket)', () => {
    const out = addCloseStep(doc());
    expect(closeOf(out).blocks[0]).toEqual({ type: 'board', text: 'b' });
    const b = closeOf(out).blocks[1];
    expect(b).toEqual({
      type: 'key_points',
      title: CLOSE_TITLE,
      items: [
        'Read the success criteria aloud: You can tell rotatory from vibratory motion. You can sort motion by path.',
        THUMBS_LINE,
      ],
    });
    expect(THUMBS_LINE).toMatch(/thumbs up/i);
    expect(THUMBS_LINE).toMatch(/sideways/i);
    expect(THUMBS_LINE).toMatch(/down/i);
  });

  test('never changes the document it is given', () => {
    const d = doc();
    const before = JSON.stringify(d);
    addCloseStep(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  test('a second pass (her change, built on her last plan) keeps exactly one box', () => {
    const once = addCloseStep(doc());
    const twice = addCloseStep(once);
    expect(closeOf(twice).blocks.filter((b) => b.title === CLOSE_TITLE)).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  test('a conclusion with no room for the criteria gets ONE short line, so it stays within its word budget', () => {
    const long = 'You can explain in your own words every step of a very long process with many parts.';
    const out = addCloseStep(doc({ objectives: { items: Array.from({ length: 9 }, () => ({ text: long })) } }));
    expect(closeOf(out).blocks[1].items).toEqual([SHORT_LINE]);
    expect(SHORT_LINE).toMatch(/success criteria/);
    expect(SHORT_LINE).toMatch(/thumbs up, sideways or down/);
  });

  test('the box never takes a conclusion that fits over its budget', () => {
    const filler = Array.from({ length: CONCLUSION_MAX_WORDS - 30 }, () => 'w').join(' ');
    const d = doc();
    d.sections[1].reteach_rule = filler;
    const out = addCloseStep(d);
    expect(closeOf(out).blocks[1].items).toEqual([SHORT_LINE]);
    expect(conclusionWords(closeOf(out))).toBeLessThanOrEqual(CONCLUSION_MAX_WORDS);
  });

  test('a repeat pass does not count its own earlier box against the room', () => {
    const once = addCloseStep(doc());
    expect(closeOf(addCloseStep(once)).blocks[1].items).toHaveLength(2);
  });

  test('no objectives → the short line', () => {
    const out = addCloseStep(doc({ objectives: { items: [] } }));
    expect(closeOf(out).blocks[1].items).toEqual([SHORT_LINE]);
  });

  test('a short line with an Urdu toggle is one Urdu line, and no stale second line is left behind', () => {
    const d = doc({ ur_overlay: { '/sections/1/blocks/1/items/1': 'old' }, objectives: { items: [] } });
    const ov = addCloseStep(d).ur_overlay;
    expect(ov['/sections/1/blocks/1/items/0']).toBe(SHORT_LINE_UR);
    expect(ov['/sections/1/blocks/1/items/1']).toBeUndefined();
  });

  test('a document with an Urdu toggle gets Urdu for the title and both lines, using its own Urdu objectives', () => {
    const d = doc({ ur_overlay: { '/objectives/items/0/text': 'آپ الف بتا سکتے ہیں۔', '/objectives/items/1/text': 'آپ ب بتا سکتے ہیں۔' } });
    const out = addCloseStep(d);
    const i = out.sections.findIndex((s) => s.id === 'conclusion');
    const ov = out.ur_overlay;
    expect(ov[`/sections/${i}/blocks/1/title`]).toBe(CLOSE_TITLE_UR);
    expect(ov[`/sections/${i}/blocks/1/items/0`]).toBe('کامیابی کے معیار بلند آواز سے پڑھیں: آپ الف بتا سکتے ہیں۔ آپ ب بتا سکتے ہیں۔');
    expect(ov[`/sections/${i}/blocks/1/items/1`]).toBe(THUMBS_LINE_UR);
  });

  test('the toggle\'s existing entries are kept as they are', () => {
    const d = doc({ ur_overlay: { '/sections/1/blocks/0/text': 'بورڈ' } });
    expect(addCloseStep(d).ur_overlay['/sections/1/blocks/0/text']).toBe('بورڈ');
  });

  test('a repeat pass with a toggle rewrites the same pointers, at the box\'s own place', () => {
    const d = doc({ ur_overlay: {} });
    const once = addCloseStep(d);
    expect(addCloseStep(once)).toEqual(once);
  });

  test('a document with no Urdu toggle gets none', () => {
    expect(addCloseStep(doc()).ur_overlay).toBeUndefined();
  });

  test('an Urdu-medium document is written in Urdu directly, with no toggle', () => {
    const d = doc({ provenance: { medium: 'ur' }, objectives: { items: [{ text: 'آپ قاعدہ بتا سکتے ہیں۔' }] } });
    const b = closeOf(addCloseStep(d)).blocks[1];
    expect(b.title).toBe(CLOSE_TITLE_UR);
    expect(b.items).toEqual(['کامیابی کے معیار بلند آواز سے پڑھیں: آپ قاعدہ بتا سکتے ہیں۔', THUMBS_LINE_UR]);
    expect(addCloseStep(d).ur_overlay).toBeUndefined();
  });

  test('a document with no conclusion (or no sections list) comes back unchanged', () => {
    expect(addCloseStep({ sections: { warmup: 'x' } })).toEqual({ sections: { warmup: 'x' } });
    const d = doc({ sections: [{ id: 'introduction', blocks: [] }] });
    expect(addCloseStep(d)).toEqual(d);
    expect(addCloseStep(null)).toBe(null);
  });
});

// bd-snkn32.50 — the page guard takes the close back out of a lesson it would push over the cap.
describe('removeCloseStep', () => {
  const { removeCloseStep } = require('../../bot/shared/services/lp612-own-close');
  test('takes the box and its Urdu toggle entries back out, nothing else', () => {
    const before = doc({ ur_overlay: { '/objectives/items/0/text': 'آپ', '/objectives/items/1/text': 'آپ' } });
    const out = removeCloseStep(addCloseStep(before));
    expect(out).toEqual(before);
  });
  test('an Urdu-medium box is found by its Urdu title', () => {
    const before = doc({ provenance: { medium: 'ur' } });
    expect(removeCloseStep(addCloseStep(before))).toEqual(before);
  });
  test('null when there is no box to take out; the given doc is never changed', () => {
    const d = doc();
    expect(removeCloseStep(d)).toBeNull();
    const withBox = addCloseStep(d);
    const copy = JSON.parse(JSON.stringify(withBox));
    removeCloseStep(withBox);
    expect(withBox).toEqual(copy);
  });
});

// bd-snkn32.50 — the one-line form names all three things 5D asks for: before the exit ticket is collected, the
// success criteria read aloud, a self-prediction. With "self-predict" + "exit ticket" in the line the shelf reviewer
// rated 5D >=3 on 11/14 ready-made anchor reviews, against 9/14 with the older line (bd-snkn32.50 results/score-5d-*).
test('the one-line close names the exit ticket, the success criteria and the self-prediction (EN + UR)', () => {
  expect(SHORT_LINE).toMatch(/exit ticket/);
  expect(SHORT_LINE).toMatch(/success criteria aloud/);
  expect(SHORT_LINE).toMatch(/self-predict/);
  expect(SHORT_LINE_UR).toMatch(/اختتامی پرچی/);
  expect(SHORT_LINE_UR).toMatch(/اندازہ/);
});
