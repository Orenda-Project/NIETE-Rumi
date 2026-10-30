/**
 * v29 review, layout rows the renderer and picture pipeline own (bd-5jmnfj.4.58, round 4).
 *
 * - G1 English Q13 ii and G2 Urdu Q7 printed a picture in a grey frame. The frame sat inside the
 *   picture (13-16px in from the edge of a 320px drawing), so the outer-ring check passed it.
 *   The v29 drawings: G2 Urdu Q7 a full grey rectangle 13-14px in; G1 English Q13 ii a landscape
 *   rectangle, its sides 15px in and its top and bottom 51px in; G2 English Q15 three sides 31-32px
 *   in and the fourth at 39px. The v28 drum (G1 English Q5), its two straight sides 29px in over
 *   two thirds of the height, is a drawing and not a frame.
 * - G1 Maths Q8 (five compare scenes, one to a line, each 45 mm over its stem and box) measured
 *   10 + 5 x 70 = 360 mm, past the 245 mm a slot may take and past the 70% floor of a fit, so it split
 *   over p.5-6 and the pencil printed small. Two scenes to a line take three lines and fit one page
 *   with each picture larger than v29's.
 * - G5 Urdu Q7 and G5 English Q10 printed their scene a quarter of the 70mm frame, pushed to one
 *   edge: the scene kept the 45mm Grade 1-2 height and sat at the frame's start.
 */

const Pictures = require('../../bot/shared/services/assessment/fde-pictures');
const { insetFramed } = require('../../bot/shared/services/assessment/fde-picture-inset-frame');
const { PICTURE_CSS } = require('../../bot/shared/services/assessment/fde-picture-block');
const Fit = require('../../bot/shared/services/assessment/fde-slot-fit');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');

const STUB = 'data:image/jpeg;base64,AAAA';
const scene = (describe) => ({ kind: 'scene', describe, src: STUB });
const Q8 = ['pencil and a crayon', 'tree and a lamp post', 'elephant and a feather', 'bus and a motorbike', 'leaf and a stone']
  .map((d, i) => ({ slot: 'g1.maths.B.Q8', main_question: 'Look at the picture and answer.', question: `Which is ${['longer', 'taller', 'heavier', 'shorter', 'lighter'][i]}?`,
    answer: 'the pencil', marks: 1, lines: 1, blooms: 'Understand', picture: scene(`a ${d} side by side`) }));

/** The v29 G1 Maths paper with every other slot filled plainly. */
function g1Maths() {
  const S = Patterns.get('fde_g1_2026').subjects.maths;
  const tree = { unseen: { objective: {}, subjective: {} } };
  S.sections.forEach((sec) => sec.slots.forEach((slot) => {
    const items = slot.slot === 'g1.maths.B.Q8' ? Q8 : Array.from({ length: slot.generate }, (_, i) => ({
      slot: slot.slot, question: `Question ${i + 1}`, answer: 'a', marks: slot.marks_each, blooms: 'Apply',
      ...(slot.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three', 'd) four'], answer: 'a) one' } : {}),
      ...(slot.picture ? { picture: { kind: slot.picture[0] === 'scene' ? 'scene' : 'object', name: 'ball', describe: 'a ball', src: STUB } } : {}),
    }));
    (tree.unseen[slot.category][slot.type] = tree.unseen[slot.category][slot.type] || []).push(...items);
  }));
  const { examJson } = applyLayout(tree, S, { kind: 'fde' }, { now: '2026-10-30T07:00:00.000Z' });
  return R.renderPaper({ examJson, grade: 1, subject: 'maths' });
}

function slotOf(page, slot) {
  const at = page.indexOf(`data-slot="${slot}"`);
  const start = Math.max(page.lastIndexOf('<div class="slot ', at), page.lastIndexOf('<div class="slot"', at));
  const next = page.indexOf('<div class="slot', at);
  return page.slice(start, next < 0 ? undefined : next);
}

const W = 320;
function blank() { return { data: new Uint8Array(W * W).fill(255), width: W, height: W }; }
function hline(img, y, from, to, v = 200) { for (let x = from; x < to; x += 1) img.data[y * W + x] = v; }
function vline(img, x, from, to, v = 200) { for (let y = from; y < to; y += 1) img.data[y * W + x] = v; }

describe('a grey frame drawn inside the picture is a frame', () => {
  test('a full rectangle 13px in (v29 G2 Urdu Q7)', () => {
    const img = blank();
    for (const k of [13, 14]) { hline(img, k, k, W - k); hline(img, W - 1 - k, k, W - k); vline(img, k, k, W - k); vline(img, W - 1 - k, k, W - k); }
    expect(insetFramed(img)).toBe(true);
    expect(Pictures.framed(img)).toBe(true);
  });

  test('a landscape rectangle, sides 15px in and top and bottom 51px in (v29 G1 English Q13 ii)', () => {
    const img = blank();
    for (const k of [15, 16]) { vline(img, k, 51, 268); vline(img, W - 1 - k, 51, 268); }
    for (const y of [51, 52, 266, 267]) hline(img, y, 15, W - 15);
    expect(Pictures.framed(img)).toBe(true);
  });

  test('three sides 31px in and the fourth 39px in (v29 G2 English Q15)', () => {
    const img = blank();
    hline(img, 31, 31, W - 31); hline(img, W - 32, 31, W - 31); vline(img, W - 32, 31, W - 31); vline(img, 39, 31, W - 31);
    expect(Pictures.framed(img)).toBe(true);
  });
});

describe('a scene without a frame is not one', () => {
  test('a ground line across the bottom', () => {
    const img = blank();
    hline(img, W - 20, 0, W, 0);
    expect(insetFramed(img)).toBe(false);
  });

  test('a window drawn in the middle (its sides lie past the margin)', () => {
    const img = blank();
    hline(img, 80, 80, W - 80, 0); hline(img, W - 80, 80, W - 80, 0); vline(img, 80, 80, W - 80, 0); vline(img, W - 80, 80, W - 80, 0);
    expect(insetFramed(img)).toBe(false);
  });

  test('a drum: two straight sides 29px in over two thirds of the height (v28 G1 English Q5)', () => {
    const img = blank();
    for (const k of [29, 30]) { vline(img, k, 60, 270, 60); vline(img, W - 1 - k, 60, 270, 60); }
    expect(insetFramed(img)).toBe(false);
  });

  test('a ground line and one tree trunk near the edge', () => {
    const img = blank();
    hline(img, W - 20, 0, W, 0); vline(img, 20, 100, W - 20, 0);
    expect(insetFramed(img)).toBe(false);
  });
});

describe('a slot of compare scenes prints two to a line and fits one page (v29 G1 Maths Q8)', () => {
  test('five scenes are three lines of two, kept on one page, each picture 50 mm', () => {
    expect(Fit.sceneGrid(Q8, {})).toBe(true);
    expect(Fit.slotHeightMm({ n: 5, pic: Fit.PAIR_SCENE_MM, perRow: 2 })).toBeLessThanOrEqual(245);
    expect(Fit.PAIR_SCENE_MM).toBeGreaterThan(45);
    const html = slotOf(g1Maths(), 'g1.maths.B.Q8');
    expect(html).toMatch(/class="slot short"/);
    expect((html.match(/class="pic-row"/g) || []).length).toBe(3);
    expect((html.match(/class="q pic-cell pair"/g) || []).length).toBe(5);
    expect(html).toContain('Which is longer?'); // the stem still prints
  });

  test('a single scene, a scene in a frame or bubble, and object pictures are not paired', () => {
    expect(Fit.sceneGrid(Q8.slice(0, 1), {})).toBe(false);
    expect(Fit.sceneGrid(Q8, { frame: true })).toBe(false);
    expect(Fit.sceneGrid(Q8, { bubble: true })).toBe(false);
    expect(Fit.sceneGrid(Q8, { mcq: true })).toBe(false);
    expect(Fit.sceneGrid(Q8.map((q) => ({ ...q, picture: { kind: 'object', name: 'ball', src: STUB } })), {})).toBe(false);
    expect(Fit.sceneGrid(Q8.map((q) => ({ ...q, questions: [{ question: 'a' }] })), {})).toBe(false);
  });

  test('the paired cell is half the line and its scene the paired size', () => {
    const css = Fit.SLOT_FIT_CSS.replace(/\s+/g, ' ');
    expect(css).toMatch(/\.q\.pic-cell\.pair \{[^}]*width: calc\(50% - 4\.2mm\);/);
    expect(css).toMatch(/\.q\.pic-cell\.pair \.pic-scene img \{ height: 50mm;/);
  });
});

describe('a picture drawn in a G5 frame fills it', () => {
  test('the scene is centred in the frame and fills it, inside its border', () => {
    const css = PICTURE_CSS.replace(/\s+/g, ' ');
    expect(css).toMatch(/\.frame > \.pic-scene \{[^}]*position: absolute; inset: 3mm;[^}]*justify-content: center;/);
    expect(css).toMatch(/\.frame > \.pic-scene img \{[^}]*width: 100%; height: 100%; object-fit: contain;/);
  });
});
