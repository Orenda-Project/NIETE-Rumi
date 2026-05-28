/**
 * Flow-options ⇄ Flow-JSON sync guard.
 *
 * flow-options.js is the SOURCE OF TRUTH for the pic-LP confirmation Flow's
 * dropdown source arrays (grades / subjects / languages). The static Flow JSON
 * (docs/flows/pic-lp-confirm-flow.json) carries the SAME arrays as
 * `__example__` data — and they had DRIFTED (the JSON was missing the Arabic
 * 'ar' language that buildLanguages() emits).
 *
 * This test asserts the two stay in lockstep so the drift can't silently return.
 * The code module is the authority; if this fails, align the JSON to the module.
 */

const fs = require('fs');
const path = require('path');
const FlowOptions = require('../../bot/shared/services/pic-to-lp/flow-options');

const FLOW_JSON_PATH = path.resolve(
  __dirname,
  '../../docs/flows/pic-lp-confirm-flow.json'
);

function loadFlowForm() {
  const raw = fs.readFileSync(FLOW_JSON_PATH, 'utf8');
  const flow = JSON.parse(raw);
  const screen = flow.screens.find((s) => s.id === 'PIC_LP_FORM');
  expect(screen).toBeDefined();
  return screen.data;
}

// Compare arrays of {id,title} (or {id,title,description}) by their id/title
// pairs, order-sensitive — the dropdown order matters to the teacher.
function idTitlePairs(arr) {
  return arr.map((o) => ({ id: o.id, title: o.title }));
}

describe('flow-options.js ⇄ pic-lp-confirm-flow.json sync', () => {
  it('grades example matches buildGrades()', () => {
    const data = loadFlowForm();
    expect(idTitlePairs(data.grades.__example__)).toEqual(
      idTitlePairs(FlowOptions.buildGrades())
    );
  });

  it('subjects example matches buildSubjects()', () => {
    const data = loadFlowForm();
    expect(idTitlePairs(data.subjects.__example__)).toEqual(
      idTitlePairs(FlowOptions.buildSubjects())
    );
  });

  it('languages example matches buildLanguages() (catches the ar drift)', () => {
    const data = loadFlowForm();
    expect(idTitlePairs(data.languages.__example__)).toEqual(
      idTitlePairs(FlowOptions.buildLanguages())
    );
  });

  it("languages include 'ar' in BOTH the code module and the Flow JSON", () => {
    const data = loadFlowForm();
    const codeIds = FlowOptions.buildLanguages().map((l) => l.id);
    const jsonIds = data.languages.__example__.map((l) => l.id);
    expect(codeIds).toContain('ar');
    expect(jsonIds).toContain('ar');
  });
});
