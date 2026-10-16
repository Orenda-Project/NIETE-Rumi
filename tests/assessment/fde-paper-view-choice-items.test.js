/**
 * The phone's paper view hands each slot's items to the renderer's choiceLine, as the printed
 * paper does, so a one-item slot's "{q}" (English Q5 "the poem “{q}”"; any subject's slots carry the same call) is filled on the screen
 * too. Without the items the renderer cannot name the poem, and the phone prints the placeholder.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../bot/shared/storage/r2', () => ({}));

const fs = require('fs');
const path = require('path');
const Patterns = require('../../bot/shared/services/assessment/patterns');
const { applyLayout } = require('../../bot/shared/services/assessment/fde-layout');
const FDE = require('../../bot/shared/services/assessment/assessment-paper-fde.renderer');
const View = require('../../bot/shared/services/assessment/assessment-paper-view.service');

const P = Patterns.get('fde_g5_2027');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fde', 'maths.json'), 'utf8'));
const exam = applyLayout(raw, P.subjects.maths, { kind: 'fde' }, { now: '2026-10-20T07:12:00.000Z' }).examJson;

afterEach(() => jest.restoreAllMocks());

test('every slot of the phone view passes its own items to choiceLine', () => {
  const spy = jest.spyOn(FDE, 'choiceLine');
  View.buildPaperView(exam);
  expect(spy).toHaveBeenCalled();
  for (const [slot, present, , items] of spy.mock.calls) {
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(present);
    items.forEach((q) => expect(q.slot).toBe(slot.slot));
  }
});
