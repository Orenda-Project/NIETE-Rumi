'use strict';
/**
 * bd-2c1gj — ICT feedback sheet, HITL row 189: "Add Confirmation Before
 * Selecting a Lesson Plan". A human coach picking the teacher's plan from the
 * recent-LP list can tap the wrong row, and the tap linked it (and queued the
 * analysis) on the spot. The tap now asks first; linking runs only on "Yes";
 * "Change lesson plan" returns to the list. Widened 2026-09-30 to the teacher's own
 * Digital Coach session too (operator): the same list, the same slip, the same ask.
 */

const HANDLER = '../../bot/shared/services/coaching/lp-coaching/lp-list-selection.handler';
const SID = 'd2163959-2942-4667-abb8-ab89c8cf7408';
const ASSET = '5f0c7e2a-1b3d-4c8e-9a6f-2d4b8e1c7a90';
const FROM = '923001234567';
const COACH_ID = 'c0ac0000-0000-4000-8000-000000000001';

const cp = (s) => [...s].length;

function deps({ status = 'awaiting_lesson_plan', lang = 'en', buttonsOk = true } = {}) {
  const log = { sent: [], buttons: [], queued: [], linkedWith: null, resent: [], recomputed: [] };
  const d = {
    sessionStatus: async () => status,
    describeSelection: async () => ({ title: 'Fractions: halves', description: 'Grade 4 Math · Ch3 Day 2 · p.24-25 · today' }),
    sendMessage: async (to, text) => { log.sent.push({ to, text }); return true; },
    sendButtons: async (to, payload) => { log.buttons.push({ to, payload }); return buttonsOk; },
    resendList: async (sid, to, l) => { log.resent.push({ sid, to, l }); return true; },
    queueAnalysis: async (sid) => { log.queued.push(sid); return true; },
    resolveLanguage: async () => lang,
    linker: {
      handleLPSelection: async (sid, id) => {
        log.linkedWith = id;
        return { lesson_plan_link_method: 'selected_recent', awaiting_upload: false };
      },
    },
    setMediaTarget: async () => true,
    recomputeFidelity: async (sid) => { log.recomputed.push(sid); return { recomputed: true }; },
    userId: COACH_ID,
  };
  return { d, log };
}

function load() {
  jest.resetModules();
  return require(HANDLER);
}

describe('tapping a recent lesson plan asks to confirm first', () => {
  test('the tap links nothing, queues nothing, and names the plan with Yes / Change lesson plan', async () => {
    const { handleLpListSelection } = load();
    const { d, log } = deps();
    const handled = await handleLpListSelection(`lp_select_${ASSET}_${SID}`, FROM, d);

    expect(handled).toBe(true);
    expect(log.linkedWith).toBeNull();
    expect(log.queued).toHaveLength(0);
    expect(log.buttons).toHaveLength(1);
    const { payload } = log.buttons[0];
    expect(payload.body).toContain('Fractions: halves');
    expect(payload.body).toContain('Grade 4 Math · Ch3 Day 2');
    expect(payload.buttons.map((b) => b.id)).toEqual([
      `lpconfirm_yes_${ASSET}_${SID}`,
      `lpconfirm_no_${SID}`,
    ]);
    expect(payload.buttons.map((b) => b.title)).toEqual(['Yes', 'Change lesson plan']);
    // HITL row 189 copy: "You have selected [Lesson Plan Name]. Do you want to proceed?"
    expect(payload.body).toMatch(/^You have selected \*Fractions: halves\*\./);
    expect(payload.body).toMatch(/Do you want to proceed\?$/);
  });

  test('an Urdu coach gets the confirmation in Urdu, every button within 20 code points', async () => {
    // Urdu copy must not gender the coach (no «چاہتے / چاہتی»).
    const { handleLpListSelection } = load();
    const { d, log } = deps({ lang: 'ur' });
    await handleLpListSelection(`lp_select_${ASSET}_${SID}`, FROM, d);

    const { payload } = log.buttons[0];
    expect(payload.body).toMatch(/[؀-ۿ]/);
    expect(payload.body).toContain('Fractions: halves');
    expect(payload.body).not.toMatch(/چاہت[ےی]/);
    expect(payload.buttons.map((b) => b.title)).toEqual(['ہاں', 'منصوبہ تبدیل کریں']);
    for (const b of payload.buttons) {
      expect(b.title).toMatch(/[؀-ۿ]/);
      expect(cp(b.title)).toBeLessThanOrEqual(20);
    }
  });

  test('English button titles fit the 20 code-point cap', async () => {
    const { handleLpListSelection } = load();
    const { d, log } = deps();
    await handleLpListSelection(`lp_select_${ASSET}_${SID}`, FROM, d);
    for (const b of log.buttons[0].payload.buttons) expect(cp(b.title)).toBeLessThanOrEqual(20);
  });

  test('a confirmation that cannot be delivered degrades to the old immediate link', async () => {
    const { handleLpListSelection } = load();
    const { d, log } = deps({ buttonsOk: false });
    await handleLpListSelection(`lp_select_${ASSET}_${SID}`, FROM, d);

    expect(log.linkedWith).toBe(`lp_select_${ASSET}_${SID}`);
    expect(log.queued).toEqual([SID]);
  });

  test('a cancelled observation is refused before any confirmation is sent', async () => {
    const { handleLpListSelection } = load();
    const { d, log } = deps({ status: 'cancelled' });
    await handleLpListSelection(`lp_select_${ASSET}_${SID}`, FROM, d);

    expect(log.buttons).toHaveLength(0);
    expect(log.linkedWith).toBeNull();
  });

  test('the Yes tap (confirmed) links without asking again', async () => {
    const { handleLpListSelection } = load();
    const { d, log } = deps();
    await handleLpListSelection(`lp_select_${ASSET}_${SID}`, FROM, { ...d, confirmed: true });

    expect(log.buttons).toHaveLength(0);
    expect(log.linkedWith).toBe(`lp_select_${ASSET}_${SID}`);
    expect(log.queued).toEqual([SID]);
  });
});

describe('the confirmation buttons', () => {
  test('"Yes" runs the existing link path for that plan', async () => {
    const { handleLpConfirmTap } = load();
    const { d, log } = deps();
    const handled = await handleLpConfirmTap(`lpconfirm_yes_${ASSET}_${SID}`, FROM, d);

    expect(handled).toBe(true);
    expect(log.buttons).toHaveLength(0);
    expect(log.linkedWith).toBe(`lp_select_${ASSET}_${SID}`);
    expect(log.queued).toEqual([SID]);
    const { getCoachingMessage } = require('../../bot/shared/config/coaching-messages');
    expect(log.sent.map((s) => s.text)).toContain(getCoachingMessage('lessonPlan_linked', 'en'));
  });

  test('"Yes" after the review was submitted links nothing (existing guard still applies)', async () => {
    const { handleLpConfirmTap } = load();
    const { REVIEW_SUBMITTED_STATUSES } = require('../../bot/shared/services/coaching/fidelity/fidelity-recompute.service');
    const { d, log } = deps({ status: REVIEW_SUBMITTED_STATUSES[0] });
    await handleLpConfirmTap(`lpconfirm_yes_${ASSET}_${SID}`, FROM, d);

    expect(log.linkedWith).toBeNull();
    expect(log.queued).toHaveLength(0);
  });

  test('"Change lesson plan" links nothing and returns to the lesson-plan list', async () => {
    const { handleLpConfirmTap } = load();
    const { d, log } = deps();
    const handled = await handleLpConfirmTap(`lpconfirm_no_${SID}`, FROM, d);

    expect(handled).toBe(true);
    expect(log.linkedWith).toBeNull();
    expect(log.queued).toHaveLength(0);
    expect(log.resent).toEqual([{ sid: SID, to: FROM, l: 'en' }]);
  });

  test('"Change lesson plan" on a cancelled observation re-sends nothing', async () => {
    const { handleLpConfirmTap } = load();
    const { d, log } = deps({ status: 'cancelled' });
    await handleLpConfirmTap(`lpconfirm_no_${SID}`, FROM, d);

    expect(log.resent).toHaveLength(0);
    expect(log.sent).toHaveLength(1);
  });

  test('an unrelated button id is not consumed', async () => {
    const { handleLpConfirmTap } = load();
    const { d } = deps();
    expect(await handleLpConfirmTap(`lessonplan_yes_${SID}`, FROM, d)).toBe(false);
  });
});

/**
 * The production defaults (no injected lookups): the observation type, the
 * tapped row's label and the send all go through the real code, with only the
 * network boundary faked — Supabase rows, the catalogue and the WhatsApp send.
 */
describe('the real lookups, faked only at the network boundary', () => {
  const TEACHER_ID = 'teac0000-0000-4000-8000-000000000002';

  function fakeSupabase(rows) {
    return {
      from: (table) => {
        const b = {
          select: () => b, eq: () => b, order: () => b, limit: () => b, or: () => b,
          update: () => b,
          maybeSingle: async () => ({ data: (rows[table] || [])[0] || null, error: null }),
          single: async () => ({ data: (rows[table] || [])[0] || null, error: null }),
          then: (res, rej) => Promise.resolve({ data: rows[table] || [], error: null }).then(res, rej),
        };
        return b;
      },
    };
  }

  function loadWithFakes(rows) {
    jest.resetModules();
    const wa = { buttons: [], texts: [], lists: [] };
    jest.doMock('../../bot/shared/config/supabase', () => fakeSupabase(rows));
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendInteractiveButtons: async (to, p) => { wa.buttons.push({ to, p }); return true; },
      sendInteractiveMessage: async (to, l) => { wa.lists.push({ to, l }); return true; },
      sendMessage: async (to, t) => { wa.texts.push({ to, t }); return true; },
    }));
    jest.doMock('../../bot/shared/services/lp-v8-catalog.service', () => ({
      lessonById: () => ({ lesson: { topic: 'Fractions: halves', day_label: 'Day 2', pages_label: 'p.24-25' }, chapter: { number: 3 } }),
    }));
    const mod = require(HANDLER);
    return { mod, wa };
  }

  const prevFidelity = process.env.LP_FIDELITY_ENABLED;
  beforeEach(() => { process.env.LP_FIDELITY_ENABLED = 'true'; });
  afterEach(() => {
    if (prevFidelity === undefined) delete process.env.LP_FIDELITY_ENABLED;
    else process.env.LP_FIDELITY_ENABLED = prevFidelity;
    jest.dontMock('../../bot/shared/config/supabase');
    jest.dontMock('../../bot/shared/services/whatsapp.service');
    jest.dontMock('../../bot/shared/services/lp-v8-catalog.service');
  });

  const rows = {
    coaching_sessions: [{
      status: 'awaiting_lesson_plan', observation_type: 'leader_observation',
      observer_user_id: COACH_ID, user_id: TEACHER_ID, users: { preferred_language: 'en' },
    }],
    users: [{ preferred_language: 'en' }],
    niete_lp_downloads: [{
      asset_id: ASSET, lesson_id: 'g4-math-ch3-seg002', version_stamp: 'v8', content_hash: 'h',
      grade: '4', subject: 'math', chapter_number: 3, created_at: new Date().toISOString(),
    }],
  };

  test('a coach tap on an observation sends the named confirmation through WhatsApp', async () => {
    const { mod, wa } = loadWithFakes(rows);
    let linked = false;
    await mod.handleLpListSelection(`lp_select_${ASSET}_${SID}`, FROM, {
      userId: COACH_ID,
      linker: { handleLPSelection: async () => { linked = true; return {}; } },
      queueAnalysis: async () => true,
    });

    expect(linked).toBe(false);
    expect(wa.buttons).toHaveLength(1);
    expect(wa.buttons[0].p.body).toContain('Fractions: halves');
    expect(wa.buttons[0].p.body).toContain('Grade 4 Math');
    expect(wa.buttons[0].p.buttons[0].id).toBe(`lpconfirm_yes_${ASSET}_${SID}`);
  });

  test('"Change lesson plan" re-sends the recent-LP list through WhatsApp', async () => {
    const { mod, wa } = loadWithFakes(rows);
    await mod.handleLpConfirmTap(`lpconfirm_no_${SID}`, FROM, { userId: COACH_ID });

    expect(wa.lists).toHaveLength(1);
    const ids = wa.lists[0].l.action.sections.flatMap((s) => s.rows.map((r) => r.id));
    expect(ids).toContain(`lp_select_${ASSET}_${SID}`);
  });

  test('a teacher on her own Digital Coach session is asked to confirm too', async () => {
    const selfServe = { ...rows, coaching_sessions: [{ ...rows.coaching_sessions[0], observation_type: null, observer_user_id: null }] };
    const { mod, wa } = loadWithFakes(selfServe);
    let linked = false;
    await mod.handleLpListSelection(`lp_select_${ASSET}_${SID}`, FROM, {
      userId: TEACHER_ID,
      linker: { handleLPSelection: async () => { linked = true; return { lesson_plan_link_method: 'selected_recent' }; } },
      queueAnalysis: async () => true,
    });

    expect(linked).toBe(false);
    expect(wa.buttons).toHaveLength(1);
    expect(wa.buttons[0].p.body).toContain('Fractions: halves');
    expect(wa.buttons[0].p.buttons.map((b) => b.id)).toEqual([`lpconfirm_yes_${ASSET}_${SID}`, `lpconfirm_no_${SID}`]);
  });
});

describe('the new strings are catalogued in both languages', () => {
  test.each(['lessonPlan_confirm_prompt', 'lessonPlan_confirm_yes', 'lessonPlan_confirm_change'])('%s has en and ur', (key) => {
    const { COACHING_MESSAGES, TODO } = require('../../bot/shared/config/coaching-messages');
    expect(COACHING_MESSAGES[key]).toBeDefined();
    expect(COACHING_MESSAGES[key].en).toBeTruthy();
    expect(COACHING_MESSAGES[key].ur).toBeTruthy();
    expect(COACHING_MESSAGES[key].ur).not.toBe(TODO);
  });
});

describe('dispatch (Class A — no orphan button id)', () => {
  const fs = require('fs');
  const path = require('path');
  // Strip comments so a mention in a comment cannot satisfy the assertion.
  const src = fs.readFileSync(path.join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('button_reply routes lpconfirm_ to handleLpConfirmTap', () => {
    const start = src.indexOf("buttonId.startsWith('lpconfirm_')");
    expect(start).toBeGreaterThan(-1);
    const branch = src.slice(start, src.indexOf('else if (buttonId.startsWith(', start + 10));
    expect(branch).toMatch(/handleLpConfirmTap\(/);
  });
});
