/**
 * bd-6cnaj (R50 / R55) and bd-0cxz6 (R53) — two field-reported faults.
 *
 * bd-6cnaj. Nouman (RM, 19 Aug): observed three teachers, debriefed two, and the
 * third sat in Pending Debriefs titled "Observation / Report not yet sent". Tapping
 * it answered "This debrief has already been completed." It had not been.
 *
 *   debriefsScreen() builds its list from TWO queries — debriefs still to do
 *   (debrief_status 'pending') and debriefs done whose report never reached the
 *   teacher ('done') — and stamped the SAME on-click action on both. That action
 *   routes to startDebrief, whose guard correctly refuses anything not 'pending'.
 *   The guard is right; the row was pointed at the wrong handler.
 *
 *   The send path is NOT new: ObserveSend.startSendFlow already exists, is tested,
 *   and already works from the legacy WhatsApp list (whatsapp-bot.js, row id
 *   `observe_send_<id>`). Only the Flow surface was mis-wired. Measured on prod
 *   2026-08-19: 68 reports across 35 coaches unreachable this way, accruing ~3/day.
 *
 * bd-0cxz6. Fatima (18 Aug): /observe does nothing for a coach with no schools.
 *   maybeLaunchVisitFlow gates the whole Flow on leaderHasAssignment, so a coach
 *   with zero schools never sees the menu — and therefore can never reach "Add or
 *   remove a school" to add her first one. The add-school feature shipped 19 Aug
 *   does NOT fix this: the gate sits in front of it. 22 of 80 prod coaches (27%).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OBSERVE_SCHEDULING_UI = 'true';

const path = require('path');
const fs = require('fs');
const HANDLER = path.join(__dirname, '../../shared/handlers/observe-visit-flow.handler.js');
const RESPONSE = path.join(__dirname, '../../shared/handlers/flow-response.handler.js');
const COMMAND = path.join(__dirname, '../../shared/handlers/observe-command.handler.js');

describe('bd-6cnaj · the two row types must not share one action', () => {
  let H;
  const PENDING = [{ id: 'sess-pending-1', created_at: '2026-08-18T09:00:00Z',
    analysis_data: { teacher_delivery: { teacher_name: 'Ayesha Khan' } } }];
  const UNSENT = [{ id: 'sess-unsent-1', created_at: '2026-08-18T11:00:00Z',
    analysis_data: { teacher_delivery: { teacher_name: 'Sara Bibi' } } }];

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../shared/services/observe/observe-debrief.service', () => ({
      listPendingDebriefs: async () => PENDING,
      listUnsentReports: async () => UNSENT,
      listUnfinished: async () => [],
    }), { virtual: true });
    H = require('../../shared/handlers/observe-visit-flow.handler');
  });
  afterEach(() => jest.dontMock('../../shared/services/observe/observe-debrief.service'));

  // bd-tju8f: the two row types now live on SEPARATE stage screens (the
  // structural form of this suite's guarantee) — fetch both and merge.
  const rowsOf = async () => {
    const deb = (await H.handle('coach-1', 'data_exchange', 'MENU', { step: 'debriefs' }, 'coach-1', null)).data.items;
    const snd = (await H.handle('coach-1', 'data_exchange', 'MENU', { step: 'work_send' }, 'coach-1', null)).data.items;
    return [...deb, ...snd].filter((r) => r['on-click-action'].name === 'complete');
  };

  it('a debrief still to do opens the DEBRIEF path', async () => {
    const r = (await rowsOf()).find((x) => x.id === 'sess-pending-1');
    expect(r['on-click-action'].payload.observe_visit_action).toBe('debrief');
  });

  it('a report not yet sent opens the SEND path, not the debrief path', async () => {
    const r = (await rowsOf()).find((x) => x.id === 'sess-unsent-1');
    // This is the whole bug: it used to say 'debrief', so startDebrief refused it.
    expect(r['on-click-action'].payload.observe_visit_action).toBe('send_report');
    expect(r['on-click-action'].payload.session_id).toBe('sess-unsent-1');
  });

  it('the two groups never collapse to the same action again', async () => {
    const items = await rowsOf();
    const actions = new Set(items.map((i) => i['on-click-action'].payload.observe_visit_action).filter(Boolean));
    expect(actions).toEqual(new Set(['debrief', 'send_report']));
  });

  it('both rows still carry a usable label', async () => {
    for (const it of await rowsOf()) {
      expect(it['main-content'].title.length).toBeGreaterThan(0);
      expect(it['main-content'].title.length).toBeLessThanOrEqual(30);
    }
  });
});

describe('bd-6cnaj · the completion handler routes send_report to the send flow', () => {
  const src = fs.readFileSync(RESPONSE, 'utf8');

  it('hands off to ObserveSend.startSendFlow', () => {
    expect(src).toMatch(/visitAction === 'send_report'/);
    const branch = src.slice(src.indexOf("visitAction === 'send_report'"), src.indexOf("visitAction === 'send_report'") + 500);
    expect(branch).toMatch(/startSendFlow/);
  });

  it('returns BEFORE the capture prompt — the ordering trap that made a cancel ask for a recording', () => {
    const iSend = src.indexOf("visitAction === 'send_report'");
    const iFall = src.indexOf('buildVisitCapturePrompt(observeLang');
    expect(iSend).toBeGreaterThan(-1);
    expect(iSend).toBeLessThan(iFall);
  });

  it('never reaches startDebrief for a send_report tap', () => {
    // Scope to THIS branch only — a fixed-width window spills into the debrief
    // branch below, which legitimately calls startDebrief.
    const start = src.indexOf("visitAction === 'send_report'");
    const branch = src.slice(start, src.indexOf('return true;', start));
    expect(branch).toMatch(/startSendFlow/);
    expect(branch).not.toMatch(/startDebrief/);
  });
});

describe('bd-0cxz6 · a coach with no schools can still get in and add her first', () => {
  let H;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../shared/services/observe/observe-debrief.service', () => ({
      listPendingDebriefs: async () => [], listUnsentReports: async () => [],
    }), { virtual: true });
    H = require('../../shared/handlers/observe-visit-flow.handler');
  });
  afterEach(() => jest.dontMock('../../shared/services/observe/observe-debrief.service'));

  it('the launch gate lets any coach in, not only one who already has a school', () => {
    const src = fs.readFileSync(COMMAND, 'utf8');
    const fn = src.slice(src.indexOf('async function maybeLaunchVisitFlow'), src.indexOf('async function maybeLaunchVisitFlow') + 700);
    // The chicken-and-egg: the menu is the ONLY way to add a first school.
    expect(fn).toMatch(/role === 'coach'/);
  });

  it('an empty-handed coach gets a menu whose live item is adding a school', async () => {
    const m = await H.handle('coach-new', 'INIT', '', {}, 'coach-new', null, { schoolCount: 0 });
    expect(m.screen).toBe('MENU');
    const ids = m.data.items.map((i) => i.id);
    expect(ids).toContain('manage');
    // No dead ends: scheduling against an empty school list is the trap itself.
    expect(ids).not.toContain('new');
    expect(m.data.items.length).toBeGreaterThanOrEqual(1);   // NavigationList needs >=1
  });

  it('COMPUTES the school count itself — not only when handed one', async () => {
    // The gap that let a real bug through: both menu tests passed `schoolCount`
    // via opts, so neither exercised the path the product actually takes. The
    // lookup threw ReferenceError (_admin was declared inside handle(), out of
    // scope for menuScreen), the catch swallowed it, and the menu never trimmed.
    jest.resetModules();
    jest.doMock('../../shared/services/observe/observe-debrief.service', () => ({
      listPendingDebriefs: async () => [], listUnsentReports: async () => [],
    }), { virtual: true });
    jest.doMock('../../shared/services/observe/observe-school-admin.service', () => ({
      listMySchools: async () => [],            // she has none
    }), { virtual: true });
    const H2 = require('../../shared/handlers/observe-visit-flow.handler');
    const m = await H2.handle('coach-new', 'INIT', '', {}, 'coach-new', null);   // NO opts
    expect(m.data.items.map((i) => i.id)).toEqual(['manage']);
    jest.dontMock('../../shared/services/observe/observe-school-admin.service');
  });

  it('a coach with schools and an empty backlog gets a stage-row-free menu (bd-tju8f)', async () => {
    // bd-tju8f: zero-count stage rows are HIDDEN — an empty backlog means the
    // menu opens straight at schedule/new/manage. (Count-carrying stage rows
    // are covered in visit-flow-scheduling.test.js, where the counts are real.)
    const m = await H.handle('coach-1', 'INIT', '', {}, 'coach-1', null, { schoolCount: 3 });
    expect(m.data.items.map((i) => i.id)).toEqual(['schedule', 'new', 'manage']);
  });
});
