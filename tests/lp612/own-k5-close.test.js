/**
 * bd-snkn32.52 (queue #134 B) — "Before they write" for grades 1–5 own plans, the twin of the 6–12 close
 * (lp612-own-close.js). #120: 173 of 234 teachers who got a plan had none on the shelf, failing the reviewer's 5D
 * (an exit ticket in a NEW context, success criteria read aloud, pupils self-predict with thumbs). The criteria are the
 * plan's own outcome (`goal`), never model text; the thumbs line is fixed. Added by code after the gate, so it is always
 * there; the rewrite is also told to set the exit ticket in a new everyday setting. Pure module; render and worker real.
 */
jest.mock('../../bot/shared/config/supabase', () => ({ from: () => ({}) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const C = require('../../bot/shared/services/lp-k5-own-close');
const { renderK5Own } = require('../../bot/shared/services/lp-k5-own-render');
const { k5Messages } = require('../../bot/shared/services/lp-k5-own');

const SCRIPT = {
  goal: 'Count objects up to 20 and write the number.', meta: { day: 2, topic: 'Counting' },
  hook: { warmUp: { teacherAsks: 'How many?' } }, iDo: { steps: [{ action: 'Show', say: 's' }] }, weDo: { action: 'w' },
  youDo: { action: 'y' }, wrap: { exitOptions: [{ prompt: 'Count the mangoes in the basket.' }], homework: ['x'] },
};

describe('addK5Close', () => {
  it('English book: criteria (the plan\'s own outcome) read aloud, then the thumbs self-check', () => {
    const out = C.addK5Close(SCRIPT, 'en');
    expect(out.wrap.beforeTheyWrite).toEqual([`${C.READ} ${SCRIPT.goal}`, C.THUMBS_LINE]);
    expect(out.wrap.exitOptions).toEqual(SCRIPT.wrap.exitOptions);
    expect(SCRIPT.wrap.beforeTheyWrite).toBeUndefined(); // the given script is never changed
  });

  it('Urdu book: the Urdu lines', () => {
    const out = C.addK5Close({ ...SCRIPT, goal: 'بیس تک چیزیں گنیں۔' }, 'ur');
    expect(out.wrap.beforeTheyWrite).toEqual([`${C.READ_UR} بیس تک چیزیں گنیں۔`, C.THUMBS_LINE_UR]);
  });

  it('a long outcome (a class of 50 cannot hold it): one short line naming all three things instead', () => {
    const goal = Array.from({ length: C.GOAL_MAX_WORDS + 1 }, () => 'word').join(' ');
    expect(C.addK5Close({ ...SCRIPT, goal }, 'en').wrap.beforeTheyWrite).toEqual([C.SHORT_LINE]);
    expect(C.addK5Close({ ...SCRIPT, goal: '' }, 'ur').wrap.beforeTheyWrite).toEqual([C.SHORT_LINE_UR]);
  });

  it('the short line names exit ticket, criteria aloud and self-predict (what 5D asks for)', () => {
    expect(C.SHORT_LINE).toMatch(/exit ticket/);
    expect(C.SHORT_LINE).toMatch(/success criteria aloud/);
    expect(C.SHORT_LINE).toMatch(/self-predict/);
  });

  it('a second pass replaces the box, never adds another', () => {
    const twice = C.addK5Close(C.addK5Close(SCRIPT, 'en'), 'en');
    expect(twice.wrap.beforeTheyWrite).toHaveLength(2);
  });

  it('no wrap: the script as it was', () => {
    const { wrap, ...noWrap } = SCRIPT;
    expect(C.addK5Close(noWrap, 'en')).toEqual(noWrap);
    expect(C.addK5Close(null, 'en')).toBeNull();
  });
});

describe('the printed plan', () => {
  it('prints the box in the Check section, before the exit ticket', () => {
    const html = renderK5Own(C.addK5Close(SCRIPT, 'en'), { lang: 'en', grade: 1, subject: 'math' });
    const box = html.indexOf('Before they write');
    expect(box).toBeGreaterThan(html.indexOf('Check · exit ticket'));
    expect(html.indexOf('Count the mangoes')).toBeGreaterThan(box);
    expect(html).toContain('thumbs up');
  });

  it('an Urdu book prints the Urdu title', () => {
    const html = renderK5Own(C.addK5Close({ ...SCRIPT, goal: 'گنیں۔' }, 'ur'), { lang: 'ur', grade: 1, subject: 'urdu' });
    expect(html).toContain(C.CLOSE_TITLE_UR);
  });

  it('a plan without the box prints as before', () => {
    expect(renderK5Own(SCRIPT, { lang: 'en', grade: 1, subject: 'math' })).not.toContain('Before they write');
  });
});

describe('the rewrite is told: exit ticket in a new everyday setting', () => {
  it('in the system message', () => {
    const [sys] = k5Messages({ script: SCRIPT, answers: { size: '51_70', resources: ['textbook'], level: 'mixed', way: 'tarl', note: '' }, lang: 'en', grade: 2, subject: 'math' });
    expect(sys.content).toMatch(/exit ticket.*new (everyday )?setting/i);
  });
});

describe('the job adds the box before printing', () => {
  const { createOwnWorker } = require('../../bot/workers/lp612-own.worker');
  it('renderK5 and the stored script both carry it', async () => {
    const deps = {
      claimOwn: jest.fn(async () => ({ id: 'own-1', user_id: 'u1', lesson_id: 'g1', lang: 'en', template_version: 'k5_own_v1', status: 'authoring', answers: {} })),
      loadSegment: jest.fn(), readStoredDoc: jest.fn(), revise: jest.fn(), render: jest.fn(), readFile: jest.fn(),
      loadK5: jest.fn(async () => ({ script: SCRIPT, lang: 'en', grade: 1, subject: 'math', subjectName: 'Math' })),
      rewriteK5: jest.fn(async () => ({ script: SCRIPT, model: 'm' })),
      renderK5: jest.fn(async () => Buffer.from('%PDF')),
      upload: jest.fn(async () => {}), patchOwn: jest.fn(async () => {}), sleep: jest.fn(), now: () => 0, log: jest.fn(),
    };
    await createOwnWorker(deps).process({ ownId: 'own-1' });
    expect(deps.renderK5.mock.calls[0][0].script.wrap.beforeTheyWrite).toHaveLength(2);
    const stored = deps.upload.mock.calls.find(([, key]) => /\.json$/.test(key));
    expect(JSON.parse(stored[0].toString()).wrap.beforeTheyWrite).toHaveLength(2);
  });
});
