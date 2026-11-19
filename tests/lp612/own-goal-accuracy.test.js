'use strict';
/**
 * bd-snkn32.56 — a book-less plan (a goal start) gets one more check before it may join the shelf: content accuracy.
 * The plan carries text the class will copy with no book beside it, so a wrong fact is not caught by a page. One
 * extra model call lists factual errors; any error, or an unreadable answer, keeps the plan off the shelf. She always
 * keeps her plan (the reviewer never touches status). Plans from a book are reviewed exactly as before.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const { createOwnReviewer } = require('../../bot/shared/services/lp612-own-reviewer');
const { CHECKS } = require('../../bot/shared/services/lp612-own-review');
const { accuracyMessages, parseAccuracy } = require('../../bot/shared/services/lp612-own-accuracy');

const GOAL = { kind: 'topic', text: 'Air pressure around us' };
const ROW = { id: 'own-1', status: 'ready', lang: 'en', segment_id: 'grade_8_science.c02.p010-013', lesson_id: null, r2_key: 'lp612/v9/en/edits/s/h.pdf', answers: { goal: GOAL } };
const rubric = { choices: [{ message: { content: JSON.stringify({ checks: CHECKS.map((c) => ({ id: c.id, rating: 4 })) }) } }] };
const acc = (o) => ({ choices: [{ message: { content: typeof o === 'string' ? o : JSON.stringify(o) } }] });

function harness(row, accReply) {
  const patches = [];
  const create = jest.fn(async (req) => (req.job === 'lp.ownAccuracy' ? accReply : rubric));
  const deps = {
    selectRow: jest.fn(async () => ({ ...row })),
    readPlan: jest.fn(async () => '{"sections":{"iDo":"Air presses on us from all sides."}}'),
    client: { chat: { completions: { create } } },
    model: 'm', patchOwn: jest.fn(async (id, f) => { patches.push(f); }), now: () => 't', log: jest.fn(),
  };
  return { reviewer: createOwnReviewer(deps), patches, create };
}

describe('parseAccuracy', () => {
  it('reads accurate / errors, fenced or not', () => {
    expect(parseAccuracy('```json\n{"accurate": true, "errors": []}\n```')).toEqual({ accurate: true, errors: [] });
    expect(parseAccuracy('{"accurate": false, "errors": ["Air has no weight"]}')).toEqual({ accurate: false, errors: ['Air has no weight'] });
  });
  it('an answer that says accurate but lists errors is not accurate', () => {
    expect(parseAccuracy('{"accurate": true, "errors": ["x"]}').accurate).toBe(false);
  });
  it('null when unreadable', () => {
    expect(parseAccuracy('no')).toBeNull();
    expect(parseAccuracy('{"errors": []}')).toBeNull();
  });
});

describe('accuracyMessages', () => {
  it('asks for factual errors only, for her grade, with her goal and the plan', () => {
    const text = JSON.stringify(accuracyMessages({ plan: 'PLAN BODY', goal: GOAL, grade: 8 }));
    expect(text).toMatch(/factual/i);
    expect(text).toContain('Air pressure around us');
    expect(text).toContain('PLAN BODY');
    expect(text).toMatch(/Grade 8/);
  });
});

describe('the reviewer on a goal plan', () => {
  it('accurate: the accuracy check is recorded and the plan may join the shelf', async () => {
    const { reviewer, patches, create } = harness(ROW, acc({ accurate: true, errors: [] }));
    await reviewer.review('own-1');
    expect(create.mock.calls.map((c) => c[0].job)).toContain('lp.ownAccuracy');
    expect(patches[0].review_items.ACC).toBe(4);
    expect(patches[0].library_eligible).toBe(true);
  });
  it('a factual error keeps it off the shelf, whatever the rubric says', async () => {
    const { reviewer, patches } = harness(ROW, acc({ accurate: false, errors: ['Air has no weight'] }));
    await reviewer.review('own-1');
    expect(patches[0].review_items.ACC).toBe(1);
    expect(patches[0].review_pass).toBe(false);
    expect(patches[0].library_eligible).toBe(false);
  });
  it('an unreadable accuracy answer keeps it off the shelf too', async () => {
    const { reviewer, patches } = harness(ROW, acc('sorry'));
    await reviewer.review('own-1');
    expect(patches[0].review_items.ACC).toBeNull();
    expect(patches[0].library_eligible).toBe(false);
  });
  it('a plan from a book is reviewed as before: no accuracy call', async () => {
    const { reviewer, patches, create } = harness({ ...ROW, answers: {} }, acc({ accurate: false, errors: ['x'] }));
    await reviewer.review('own-1');
    expect(create.mock.calls.map((c) => c[0].job)).not.toContain('lp.ownAccuracy');
    expect(patches[0].review_items).not.toHaveProperty('ACC');
    expect(patches[0].library_eligible).toBe(true);
  });
});
