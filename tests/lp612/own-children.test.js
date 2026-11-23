/**
 * bd-snkn32.53 (queue #134 D) — the children visible in her plan. The reviewer's 6B (both a girl's and a boy's name,
 * deliberate; varied, local contexts) failed on 115 of 276 grades 1-5 own plans (#120). Both bands' rewrites are told to
 * use both names and everyday local places; a grades 1-5 plan's Opening also prints ONE fixed line (book language).
 * Grades 6-12 print nothing extra (their page cap). Pure modules; render and worker real.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const K = require('../../bot/shared/services/lp-k5-own-children');
const { CHILDREN_LINE } = require('../../bot/shared/services/lp612-own-ways');
const { renderK5Own } = require('../../bot/shared/services/lp-k5-own-render');
const { k5Messages } = require('../../bot/shared/services/lp-k5-own');
const { buildOwnInstruction } = require('../../bot/shared/services/lp612-own-instruction');

const SCRIPT = {
  goal: 'Count to 20.', meta: { day: 2, topic: 'Counting' }, hook: { warmUp: { teacherAsks: 'How many?' } },
  iDo: { steps: [{ action: 'Show' }] }, weDo: { action: 'w' }, youDo: { action: 'y' }, wrap: { exitOptions: [{ prompt: 'p' }] },
};
const ANSWERS = { size: '51_70', resources: ['textbook'], level: 'mixed', way: 'tarl', note: '' };

it('the rule names a girl and a boy, local places and the child\'s own example', () => {
  expect(CHILDREN_LINE).toMatch(/girl/);
  expect(CHILDREN_LINE).toMatch(/boy/);
  expect(CHILDREN_LINE).toMatch(/local|bazaar|village/i);
});

it('grades 1-5: the rewrite is told the rule', () => {
  const [sys] = k5Messages({ script: SCRIPT, answers: ANSWERS, lang: 'en', grade: 2, subject: 'math' });
  expect(sys.content).toContain(CHILDREN_LINE);
});

it('grades 6-12: the rewrite is told the rule', () => {
  expect(buildOwnInstruction(ANSWERS, { grade: 8, segmentId: 'sci8.c02.p010', subject: 'science' })).toContain(CHILDREN_LINE);
});

describe('addK5Children', () => {
  it('English book: the fixed line in the Opening; the given script unchanged', () => {
    const out = K.addK5Children(SCRIPT, 'en');
    expect(out.hook.childrenLine).toBe(K.LINE);
    expect(SCRIPT.hook.childrenLine).toBeUndefined();
    expect(K.LINE).toMatch(/girl.*boy|boy.*girl/);
    expect(K.LINE).toMatch(/own example/);
  });
  it('Urdu book: the Urdu line', () => {
    expect(K.addK5Children(SCRIPT, 'ur').hook.childrenLine).toBe(K.LINE_UR);
  });
  it('no hook: unchanged', () => {
    const { hook, ...noHook } = SCRIPT;
    expect(K.addK5Children(noHook, 'en')).toEqual(noHook);
  });
});

it('the printed plan shows the line in the Opening, before the first question', () => {
  const html = renderK5Own(K.addK5Children(SCRIPT, 'en'), { lang: 'en', grade: 1, subject: 'math' });
  const at = html.indexOf(K.LINE);
  expect(at).toBeGreaterThan(html.indexOf('Opening'));
  expect(at).toBeLessThan(html.indexOf('How many?'));
});

it('the job adds the line before printing and storing', async () => {
  const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
  const deps = {
    claimOwn: jest.fn(async () => ({ id: 'own-1', user_id: 'u1', lesson_id: 'g1', lang: 'en', template_version: 'k5_own_v1', status: 'authoring', answers: {} })),
    loadSegment: jest.fn(), readStoredDoc: jest.fn(), revise: jest.fn(), render: jest.fn(), readFile: jest.fn(),
    loadK5: jest.fn(async () => ({ script: SCRIPT, lang: 'en', grade: 1, subject: 'math', subjectName: 'Math' })),
    rewriteK5: jest.fn(async () => ({ script: SCRIPT, model: 'm' })),
    renderK5: jest.fn(async () => Buffer.from('%PDF')),
    upload: jest.fn(async () => {}), patchOwn: jest.fn(async () => {}), sleep: jest.fn(), now: () => 0, log: jest.fn(),
  };
  await createOwnWorker(deps).process({ ownId: 'own-1' });
  expect(deps.renderK5.mock.calls[0][0].script.hook.childrenLine).toBe(K.LINE);
});
