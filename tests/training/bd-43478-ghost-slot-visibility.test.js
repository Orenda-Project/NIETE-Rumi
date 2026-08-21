/**
 * TRAINING_HOME renders FIVE fixed level slots. A teacher with fewer levels
 * used to see the unused ones as a bare "·" — three stray dots between their
 * real levels and the "Open a level" dropdown.
 *
 * The endpoint had been sending `level_N_visible: false` for unused slots all
 * along; the published Flow JSON simply never bound it. The code comment on
 * ghostSlotData even says the ghosts hide "once the asset update ships" — that
 * asset update never shipped, so the flag was ignored for months.
 *
 * Two invariants, both load-bearing:
 *   1. every slot's heading AND body are gated on level_N_visible
 *   2. the ghost placeholder is never an EMPTY string — WhatsApp validates the
 *      whole data payload against the screen schema BEFORE applying `visible`,
 *      so '' bound to a TextBody fails the render and the client shows
 *      "Something went wrong" even though the row is hidden.
 */

const fs = require('fs');
const path = require('path');

const FLOW = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../docs/flows/teacher-training-flow-v1.json'), 'utf8'));
const SRC = fs.readFileSync(
  path.join(__dirname, '../../bot/shared/routes/teacher-training-endpoint.js'), 'utf8');

const HOME = FLOW.screens.find(s => s.id === 'TRAINING_HOME');
const SLOTS = [1, 2, 3, 4, 5];

describe('TRAINING_HOME — unused level slots are hidden, not dotted', () => {
  test.each(SLOTS)('slot %i declares a visibility flag', (n) => {
    expect(HOME.data).toHaveProperty(`level_${n}_visible`);
  });

  test.each(SLOTS)('slot %i binds that flag on BOTH its title and progress rows', (n) => {
    const bound = HOME.layout.children.filter(
      c => c.visible === `\${data.level_${n}_visible}`);
    const texts = bound.map(c => c.text);
    expect(texts).toContain(`\${data.level_${n}_title}`);
    expect(texts).toContain(`\${data.level_${n}_progress}`);
  });

  test('no level row renders unconditionally', () => {
    const ungated = HOME.layout.children.filter(
      c => /\$\{data\.level_\d_(title|progress)\}/.test(c.text || '') && !c.visible);
    expect(ungated).toEqual([]);
  });

  test('the endpoint sets the flag TRUE for a real level', () => {
    expect(SRC).toMatch(/data\[`level_\$\{slot\}_visible`\]\s*=\s*true/);
  });

  test('the endpoint sets it FALSE for a ghost', () => {
    expect(SRC).toMatch(/visible:\s*false/);
  });

  test('the ghost placeholder is never an empty string', () => {
    // '' fails schema validation before `visible` is applied -> the whole screen
    // errors out. A space (or any non-empty char) is required.
    const fn = SRC.slice(SRC.indexOf('function ghostSlotData'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).not.toMatch(/title:\s*''/);
    expect(body).not.toMatch(/progress:\s*''/);
    expect(body).toMatch(/progress:\s*' '/);
  });
});
