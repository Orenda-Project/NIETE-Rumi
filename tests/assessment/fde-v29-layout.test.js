/**
 * v28 page layout and picture size (bd-5jmnfj.4.58.4):
 *   G1 English Q7/Q8/Q11/Q12 split across pages although a slot of six items or fewer is marked short:
 *     Chromium ignores break-inside: avoid on a block taller than a page, and Q8 (four items of 45 mm
 *     picture + box), Q11 (five) and Q12 (five, a 44 mm picture over a 28 mm box) were each taller than
 *     the 270 mm a page holds; Q7's cells (30% + 6 mm padding + 4 mm margin) fitted two to a line, so
 *     nine items made a fifth line holding item ix alone;
 *   G2 English Q1 (h): the question and its answer box were siblings, so a page broke between them;
 *   G5 Maths Q1 (b) x: "Draw an angle of 70° with a protractor." got a 30 mm square;
 *   G2 Urdu Q7: the park scene, the only prompt of the slot, printed 45 mm high; the model's bitmap
 *     carried the tree canopy cut at its own edges (the page CSS has no overflow, clip or crop).
 */

const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const R = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');
const Pics = require('../../bot/shared/services/assessment/fde-pictures');
const Fit = require('../../bot/shared/services/assessment/fde-slot-fit');

const STUB = 'data:image/jpeg;base64,AAAA';
const NOW = '2026-10-30T07:00:00.000Z';
const clone = (x) => JSON.parse(JSON.stringify(x));
const withSrc = (ex) => {
  const out = clone(ex);
  for (const types of Object.values(out.unseen)) for (const list of Object.values(types)) list.forEach((q) => { if (q.picture) q.picture.src = STUB; });
  return out;
};
/** A v28 fixture's pictures get a stub src and its layout is rebuilt from the pattern (the fixture keeps sections only). */
function fixturePaper(pid, subject, grade, fixture) {
  const ex = withSrc(fixture);
  const { examJson } = applyLayout({ unseen: ex.unseen }, Patterns.get(pid).subjects[subject], { kind: 'fde' }, { now: NOW });
  return R.renderPaper({ examJson, grade, subject });
}
const g1 = () => fixturePaper('fde_g1_2026', 'english', 1, require('./fixtures/early/fde-v28-g1-english-exam.json'));
const g2en = () => fixturePaper('fde_g2_2026', 'english', 2, require('./fixtures/early/fde-v28-g2-english-exam.json'));

/** A full paper from the pattern, every slot filled, `custom` replacing one slot's items. */
function paperFor(pid, subject, grade, custom) {
  const S = Patterns.get(pid).subjects[subject];
  const tree = { unseen: { objective: {}, subjective: {} } };
  S.sections.forEach((sec) => sec.slots.forEach((slot) => {
    const items = (custom && custom[slot.slot]) || Array.from({ length: slot.generate }, (_, i) => ({
      slot: slot.slot, question: `Question ${i + 1}`, answer: 'a', marks: slot.marks_each, blooms: 'Apply',
      ...(slot.shape === 'mcq' ? { options: ['a) one', 'b) two', 'c) three', 'd) four'], answer: 'a) one' } : {}),
      ...(slot.picture && slot.picture[0] === 'scene' ? { picture: { kind: 'scene', describe: 'A park', src: STUB } } : {}),
    }));
    (tree.unseen[slot.category][slot.type] = tree.unseen[slot.category][slot.type] || []).push(...items);
  }));
  const { examJson } = applyLayout(tree, S, { kind: 'fde' }, { now: NOW });
  return R.renderPaper({ examJson, grade, subject });
}

const slotHtml = (page, slot) => {
  const at = page.indexOf(`data-slot="${slot}"`);
  const open = /<div class="slot[ "]/g;
  const start = page.lastIndexOf('<div class="slot ', at) > page.lastIndexOf('<div class="slot"', at) ? page.lastIndexOf('<div class="slot ', at) : page.lastIndexOf('<div class="slot"', at);
  open.lastIndex = at;
  const next = open.exec(page);
  return page.slice(start, next ? next.index : undefined);
};

describe('G1 English Q7: nine pictures in three lines of three, the last two lines kept together', () => {
  const html = g1();
  const block = slotHtml(html, 'g1.english.B.Q7');

  test('a cell is border-box, three to a line', () => {
    expect(html).toMatch(/\.q\.pic-cell\s*\{[^}]*box-sizing:\s*border-box/);
    expect(html).toMatch(/\.q\.pic-cell\s*\{[^}]*width:\s*calc\(33\.3/);
  });

  test('cells are grouped three to a line and the last two lines are one block that never splits', () => {
    expect((block.match(/class="pic-row"/g) || []).length).toBe(3);
    expect((block.match(/class="pic-tail"/g) || []).length).toBe(1);
    const tail = block.slice(block.indexOf('<div class="pic-tail">'));
    expect(tail).toContain('class="pic-tail"');
    expect((tail.match(/class="q pic-cell/g) || []).length).toBe(6);
    expect(html).toMatch(/\.pic-row,\s*\.pic-tail\s*\{[^}]*break-inside:\s*avoid/);
  });
});

describe('a picture slot of six items or fewer fits on one page, so break-inside: avoid can hold', () => {
  const html = g1();
  const fitOf = (slot) => Number((slotHtml(html, slot).match(/--pic-fit:\s*([\d.]+)mm/) || [])[1]);

  test('G1 English Q8 (four scenes) and Q11 (five objects) print smaller pictures', () => {
    expect(fitOf('g1.english.B.Q8')).toBeGreaterThan(20);
    expect(fitOf('g1.english.B.Q8')).toBeLessThan(45);
    expect(fitOf('g1.english.C.Q11')).toBeGreaterThan(15);
    expect(fitOf('g1.english.C.Q11')).toBeLessThan(28);
  });

  test('the estimated height of every short picture slot stays under 245 mm', () => {
    expect(Fit.slotHeightMm({ n: 4, pic: Fit.fitHeightMm({ n: 4, pic: 45 }) })).toBeLessThanOrEqual(245);
    expect(Fit.slotHeightMm({ n: 5, pic: Fit.fitHeightMm({ n: 5, pic: 28 }) })).toBeLessThanOrEqual(245);
    expect(Fit.slotHeightMm({ n: 5, pic: Fit.fitHeightMm({ n: 5, pic: 44, wide: true }), wide: true })).toBeLessThanOrEqual(245);
  });

  test('a slot that already fits keeps its picture size', () => {
    expect(Fit.fitHeightMm({ n: 1, pic: 45 })).toBeNull();
    expect(Fit.fitHeightMm({ n: 2, pic: 28 })).toBeNull();
  });

  test('the picture takes the slot variable as a ceiling, the default stays when none is set', () => {
    expect(html).toMatch(/\.pic img\s*\{[^}]*max-height:\s*var\(--pic-fit,\s*none\)/);
  });

  test('Q12 (five sentence boxes) puts each picture beside its box', () => {
    expect(html).toMatch(/\.q\.pic-cell\.wide\s*\{[^}]*display:\s*grid/);
    expect(fitOf('g1.english.C.Q12')).toBeLessThan(44);
  });
});

describe('G2 English Q1: a sub-question and its answer box never part', () => {
  const block = slotHtml(g2en(), 'g2.english.A.Q1');

  test('each sub-question and its box sit in one avoid-break block', () => {
    const wrapped = block.match(/<div class="subq"><div class="sub">[\s\S]*?<\/div><div class="write-box"[^>]*><\/div><\/div>/g) || [];
    expect(wrapped.length).toBe((block.match(/class="write-box"/g) || []).length);
    expect(wrapped.length).toBeGreaterThanOrEqual(8);
    expect(g2en()).toMatch(/\.subq\s*\{[^}]*break-inside:\s*avoid/);
  });
});

describe('G5 Maths Q1 (b): a drawing item gets a drawing space', () => {
  const html = paperFor('fde_g5_2027', 'maths', 5, {
    'maths.A.Q1b': Array.from({ length: 10 }, (_, i) => ({
      slot: 'maths.A.Q1b', question: i === 9 ? 'Draw an angle of 70° with a protractor.' : `Find ${i} + 2.`, answer: 'a', marks: 2, blooms: 'Apply',
    })),
  });
  const box = (html.match(/<div class="work-square"[^>]*>/g) || [])[0] || '';

  test('full width and at least 40 mm tall, not a 30 mm square', () => {
    expect(box).not.toBe('');
    expect(box).not.toMatch(/width:\s*30mm/);
    expect(Number((box.match(/height:\s*(\d+)mm/) || [])[1])).toBeGreaterThanOrEqual(40);
    expect(html).toMatch(/\.work-square\s*\{[^}]*width:\s*100%/);
  });
});

describe('G2 Urdu Q7: the scene that is the only prompt prints large and whole', () => {
  const html = paperFor('fde_g2_2026', 'urdu', 2);
  const block = slotHtml(html, 'g2.urdu.B.Q7');

  test('the item is marked solo-scene and its picture is at least 110 mm wide, centred', () => {
    expect(block).toContain('solo-scene');
    expect(html).toMatch(/\.q\.solo-scene \.pic-scene\s*\{[^}]*text-align:\s*center/);
    const w = html.match(/\.q\.solo-scene \.pic-scene img\s*\{[^}]*width:\s*(\d+)mm/);
    expect(Number(w && w[1])).toBeGreaterThanOrEqual(110);
  });

  test('a scene among several items, or inside a frame, keeps its size', () => {
    expect(slotHtml(g1(), 'g1.english.B.Q8')).not.toContain('solo-scene');
  });

  test('the page CSS never clips a picture', () => {
    expect(html).not.toMatch(/\.pic[^{]*\{[^}]*overflow\s*:\s*hidden/);
  });

  test('the scene prompt asks for the whole scene inside the frame with a white margin (cached scenes keep their key: v27 policy)', () => {
    const prompt = Kie.promptFor({ kind: 'scene', describe: 'A park with a tree' });
    expect(prompt).toMatch(/white margin/);
    expect(prompt).toMatch(/nothing (is )?cut off/);
    const key = Pics.cacheKey({ kind: 'scene', describe: 'A park with a tree' });
    expect(key).toBe('fde-pictures/v3/scene-no-text/a-park-with-a-tree-' + require('crypto').createHash('sha256').update('a park with a tree').digest('hex').slice(0, 8) + '.jpg');
  });

  // v29: the v28 G2 Urdu Q7 park scene was cached cut off at the edge (review: the kite and the path leave the
  // frame). A scene rejected on review gets a fresh key, as a rejected object does, so it is drawn again under
  // the margin prompt; every other cached scene keeps its key (bd-5jmnfj.4.58.5).
  test('the v28 G2 Urdu park scene, cached cut off at the edge, gets a fresh key and is drawn again', () => {
    const describe = 'A busy park scene in plain black outline: a big tree in the middle, two children flying a large kite, '
      + 'a girl on a swing, a boy riding a bicycle on a path, a large bird sitting on the grass in front. No words, letters or numbers.';
    const key = Pics.cacheKey({ kind: 'scene', describe });
    expect(key).toMatch(/-72b1e44a-r1\.jpg$/);
    expect(key).not.toBe('fde-pictures/v3/scene-no-text/a-busy-park-scene-in-plain-black-outline-a-big-tree-in-the-m-72b1e44a.jpg');
  });
});
