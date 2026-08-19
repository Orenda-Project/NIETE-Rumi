/**
 * bd-jrxo3 — raw audio must not become an observation. TDD, red-first.
 *
 * 77 observations exist in NIETE prod with `user_id = observer_user_id`: the
 * coach recorded a lesson, nothing was bound, and the row was created against
 * HER. Nobody can say afterwards which teacher was in the room, so the report
 * has no one to go to and the teacher's trend never moves. The recording was
 * real work; the record of it is unusable.
 *
 * The gate is CAPABILITY, never market name. Bare capture is not dead code — it
 * is the only path in a market with no visit Flow published (the upstream
 * Tanzania deployment), and deleting it turns /observe into a dead command
 * there.
 *
 *   OBSERVE_VISIT_FLOW_ID set   ⇒ a picker exists ⇒ bare capture is wrong.
 *   unset                       ⇒ no picker       ⇒ bare capture is the product.
 *
 * So `maybeLaunchVisitFlow` stops answering yes/no — a boolean cannot tell
 * "there is no picker here" apart from "this person may not use it" — and
 * answers 'launched' | 'declined' | 'unavailable' instead.
 *
 * Accepted cost: she re-sends the recording after binding. Holding the audio
 * and replaying it would mean storing an orphan clip and carrying it across
 * screens; not worth it for a 30-second note. The redirect says so plainly.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
  sendFlow: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  setState: jest.fn().mockResolvedValue(true),
  getState: jest.fn().mockResolvedValue(null),
  clearState: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/utils/region', () => ({ detectRegion: jest.fn().mockReturnValue('TZ') }));
jest.mock('../../shared/services/observe/observe-debrief.service', () => ({
  listPendingDebriefs: jest.fn().mockResolvedValue([]),
  listUnsentReports: jest.fn().mockResolvedValue([]),
  buildPendingListPayload: jest.fn(() => ({ body: 'x', action: { button: 'b', sections: [] } })),
  startDebriefFromAudio: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/services/observe/observe-capture.service', () => ({
  startFromAudio: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../shared/handlers/observe-visit-flow.handler', () => ({
  schoolsScreenV2: jest.fn().mockResolvedValue({ screen: 'SELECT_SCHOOL', data: { options: [] } }),
}));

// leader_schools lookup: `assignments` decides what the assignment gate sees.
const assignments = { rows: [] };
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    if (table === 'leader_schools') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: async () => ({ data: assignments.rows, error: null }),
      };
      return chain;
    }
    return { update: () => ({ eq: async () => ({ data: null, error: null }) }) };
  }),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const ObserveCapture = require('../../shared/services/observe/observe-capture.service');
const VisitFlow = require('../../shared/handlers/observe-visit-flow.handler');
const {
  maybeLaunchVisitFlow, handleObserveCommand,
} = require('../../shared/handlers/observe-command.handler');
const { routeLeaderAudio } = require('../../shared/services/observe/observe-audio-router');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const FROM = '923268124001';
const COACH = (over = {}) => ({
  id: 'coach-1', phone_number: FROM, role: 'coach', preferred_language: 'ur',
  preferences: { observe_onboarded: true, observe_onboarding_arm: 'functional' }, ...over,
});

const VISIT = 'visit-flow-id';
const withVisitFlow = (fn) => async () => {
  process.env.OBSERVE_VISIT_FLOW_ID = VISIT;
  try { await fn(); } finally { delete process.env.OBSERVE_VISIT_FLOW_ID; }
};
const withoutVisitFlow = (fn) => async () => {
  const saved = process.env.OBSERVE_VISIT_FLOW_ID;
  delete process.env.OBSERVE_VISIT_FLOW_ID;
  try { await fn(); } finally { if (saved) process.env.OBSERVE_VISIT_FLOW_ID = saved; }
};

process.env.OBSERVE_MEWAKA_FLOW_ID = 'observe-on';
process.env.OBSERVE_SCHEDULING_UI = 'true';

beforeEach(() => {
  jest.clearAllMocks();
  assignments.rows = [];
  ObserveState.getState.mockResolvedValue(null);
  VisitFlow.schoolsScreenV2.mockResolvedValue({ screen: 'SELECT_SCHOOL', data: { options: [] } });
});

// ── 1.2.a ────────────────────────────────────────────────────────────────────
describe('bd-jrxo3 1.2.a — maybeLaunchVisitFlow answers three things, not two', () => {
  it('says "unavailable" when the market has no visit Flow — the one case bare capture survives',
    withoutVisitFlow(async () => {
      expect(await maybeLaunchVisitFlow(COACH(), FROM)).toBe('unavailable');
      expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    }));

  it('says "launched" for a coach with no schools at all (bd-0cxz6 — do not regress)',
    withVisitFlow(async () => {
      assignments.rows = [];
      expect(await maybeLaunchVisitFlow(COACH(), FROM)).toBe('launched');
      expect(WhatsAppService.sendFlow).toHaveBeenCalledTimes(1);
    }));

  it('says "launched" for a non-coach who nonetheless holds an assignment',
    withVisitFlow(async () => {
      assignments.rows = [{ id: 1 }];
      expect(await maybeLaunchVisitFlow(COACH({ role: 'school_leader' }), FROM)).toBe('launched');
    }));

  it('says "declined" when a Flow exists but this person may not use it',
    withVisitFlow(async () => {
      assignments.rows = [];
      expect(await maybeLaunchVisitFlow(COACH({ role: 'school_leader' }), FROM)).toBe('declined');
      expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    }));

  it('says "declined", never "unavailable", when the send itself fails',
    withVisitFlow(async () => {
      // "I could not open it" must never be confused with "there is none here",
      // because only the second one may fall back to bare capture.
      WhatsAppService.sendFlow.mockRejectedValueOnce(new Error('meta 400'));
      expect(await maybeLaunchVisitFlow(COACH(), FROM)).toBe('declined');
    }));
});

// ── 1.2.b ────────────────────────────────────────────────────────────────────
describe('bd-jrxo3 1.2.b — only "unavailable" still arms a bare capture', () => {
  it('arms awaiting_audio exactly as today when there is no picker',
    withoutVisitFlow(async () => {
      const handled = await handleObserveCommand(COACH(), FROM, '/observe');
      expect(handled).toBe(true);
      expect(WhatsAppService.sendMessage).toHaveBeenCalledWith(FROM, observeStrings('ur').capture_prompt);
      expect(ObserveState.setState).toHaveBeenCalledWith('coach-1', 'awaiting_audio', expect.anything());
    }));

  it('never arms awaiting_audio once a picker exists — launched',
    withVisitFlow(async () => {
      await handleObserveCommand(COACH(), FROM, '/observe');
      const armed = ObserveState.setState.mock.calls.filter((c) => c[1] === 'awaiting_audio');
      expect(armed).toHaveLength(0);
    }));

  it('never arms awaiting_audio once a picker exists — declined',
    withVisitFlow(async () => {
      assignments.rows = [];
      await handleObserveCommand(COACH({ role: 'school_leader' }), FROM, '/observe');
      const armed = ObserveState.setState.mock.calls.filter((c) => c[1] === 'awaiting_audio');
      expect(armed).toHaveLength(0);
      const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
      expect(sent).toContain(observeStrings('ur').redirect_pick_teacher);
    }));

  it('does not arm a bare capture on a coach\'s FIRST-ever /observe either',
    withVisitFlow(async () => {
      await handleObserveCommand(COACH({ preferences: {} }), FROM, '/observe');  // onboarding arm
      const armed = ObserveState.setState.mock.calls.filter((c) => c[1] === 'awaiting_audio');
      expect(armed).toHaveLength(0);
    }));

  it('still onboards, and still arms, in a market with no picker',
    withoutVisitFlow(async () => {
      await handleObserveCommand(COACH({ preferences: {} }), FROM, '/observe');
      const armed = ObserveState.setState.mock.calls.filter((c) => c[1] === 'awaiting_audio');
      expect(armed).toHaveLength(1);
    }));

  it('never writes the redirect as a literal at the call site', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../shared/handlers/observe-command.handler.js'), 'utf8');
    expect(src).toMatch(/redirect_pick_teacher/);
    expect(src).not.toMatch(/Let's start from the school/);
  });
});

// ── 1.2.c ────────────────────────────────────────────────────────────────────
describe('bd-jrxo3 1.2.c — the back door: audio with nothing armed', () => {
  const audio = (over = {}) => routeLeaderAudio({
    user: COACH(), from: FROM, audioId: 'a-1', sessionId: 's-1', isLongAudio: true, ...over,
  });

  it('redirects instead of dead-ending, and writes no session',
    withVisitFlow(async () => {
      expect(await audio()).toBe(true);
      expect(ObserveCapture.startFromAudio).not.toHaveBeenCalled();
      const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
      expect(sent).toContain(observeStrings('ur').redirect_pick_teacher);
      expect(sent).not.toContain(observeStrings('ur').long_audio_no_state);
    }));

  it('opens the picker on the school screen so she can act on the line she just read',
    withVisitFlow(async () => {
      VisitFlow.schoolsScreenV2.mockResolvedValue({
        screen: 'SELECT_SCHOOL', data: { options: [{ id: 'niete:401', title: 'IMCB Bhara Kau' }] },
      });
      await audio();
      expect(WhatsAppService.sendFlow).toHaveBeenCalledWith(FROM, expect.objectContaining({
        flowId: VISIT, screen: 'SELECT_SCHOOL',
      }));
    }));

  it('opens the MENU instead when she has no schools yet — the only place to add one',
    withVisitFlow(async () => {
      VisitFlow.schoolsScreenV2.mockResolvedValue({ screen: 'SELECT_SCHOOL', data: { options: [] } });
      await audio();
      const arg = WhatsAppService.sendFlow.mock.calls[0][1];
      expect(arg.screen).toBeUndefined();
    }));

  it('keeps today\'s behaviour exactly in a market with no picker',
    withoutVisitFlow(async () => {
      expect(await audio()).toBe(true);
      const sent = WhatsAppService.sendMessage.mock.calls.map((c) => c[1]);
      expect(sent).toContain(observeStrings('ur').long_audio_no_state);
      expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    }));

  it('leaves an armed debrief recording completely alone',
    withVisitFlow(async () => {
      ObserveState.getState.mockResolvedValue({ state: 'awaiting_debrief_audio', sessionId: 'x' });
      const ObserveDebrief = require('../../shared/services/observe/observe-debrief.service');
      expect(await audio()).toBe(true);
      expect(ObserveDebrief.startDebriefFromAudio).toHaveBeenCalled();
      expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    }));

  it('leaves a coach\'s ordinary short voice note to normal chat',
    withVisitFlow(async () => {
      // Deliberate: the redirect replaces the paths that would otherwise become
      // an observation or a coaching session. Hijacking every voice note would
      // stop coaches talking to Rumi at all.
      expect(await audio({ isLongAudio: false })).toBe(false);
      expect(WhatsAppService.sendFlow).not.toHaveBeenCalled();
    }));
});

// ── 1.2.d ────────────────────────────────────────────────────────────────────
describe('bd-jrxo3 1.2.d — the line she reads', () => {
  it('exists in all three packs', () => {
    for (const l of ['en', 'ur', 'sw']) {
      expect(typeof observeStrings(l).redirect_pick_teacher).toBe('string');
      expect(observeStrings(l).redirect_pick_teacher.length).toBeGreaterThan(10);
    }
  });

  it('is a different string in each language — not English wearing a label', () => {
    const en = observeStrings('en').redirect_pick_teacher;
    expect(observeStrings('ur').redirect_pick_teacher).not.toBe(en);
    expect(observeStrings('sw').redirect_pick_teacher).not.toBe(en);
  });

  it('fits a WhatsApp body, measured in code points', () => {
    for (const l of ['en', 'ur', 'sw']) {
      expect([...observeStrings(l).redirect_pick_teacher].length).toBeLessThanOrEqual(1024);
    }
  });

  it('addresses the coach without guessing her gender (root rule)', () => {
    const ur = observeStrings('ur').redirect_pick_teacher;
    for (const stem of ['رہی ہوں گی', 'رہے ہوں گے', 'کریں گی', 'کرتی ہیں', 'چاہتی ہیں', 'سکتی ہیں']) {
      expect(ur).not.toContain(stem);
    }
  });

  it('says plainly that the recording has to come again', () => {
    // The accepted cost of not holding an orphan clip. Saying it is the whole
    // difference between a clear instruction and a silent loss.
    for (const l of ['en', 'ur', 'sw']) {
      expect(observeStrings(l).redirect_pick_teacher.length).toBeGreaterThan(40);
    }
    expect(observeStrings('en').redirect_pick_teacher.toLowerCase()).toMatch(/again|re-?send/);
  });
});

// ── the Flow ─────────────────────────────────────────────────────────────────
describe('bd-jrxo3 — the brief can start a recording, not only schedule one', () => {
  const flow = require('../../../docs/flows/observe-visit-v2.json');
  const screen = (id) => flow.screens.find((s) => s.id === id);

  it('routes BRIEF_SCHEDULE → BRIEF', () => {
    expect(flow.routing_model.BRIEF_SCHEDULE).toContain('BRIEF');
  });

  it('offers a record-now link on the brief, since a screen may hold one Footer only', () => {
    const link = screen('BRIEF_SCHEDULE').layout.children.find((c) => c.type === 'EmbeddedLink');
    expect(link).toBeTruthy();
    expect(link['on-click-action'].name).toBe('navigate');
    expect(link['on-click-action'].next).toEqual({ type: 'screen', name: 'BRIEF' });
  });

  it('hands BRIEF every key it declares — a missing one fails the whole screen', () => {
    const link = screen('BRIEF_SCHEDULE').layout.children.find((c) => c.type === 'EmbeddedLink');
    const declared = Object.keys(screen('BRIEF').data);
    expect(Object.keys(link['on-click-action'].payload).sort()).toEqual(declared.sort());
  });

  it('every key the link passes is one BRIEF_SCHEDULE actually has', () => {
    const link = screen('BRIEF_SCHEDULE').layout.children.find((c) => c.type === 'EmbeddedLink');
    const available = Object.keys(screen('BRIEF_SCHEDULE').data);
    for (const [k, v] of Object.entries(link['on-click-action'].payload)) {
      expect(v).toBe(`\${data.${k}}`);
      expect(available).toContain(k);
    }
  });

  it('leaves the scheduling Footer where it was', () => {
    const footer = screen('BRIEF_SCHEDULE').layout.children.find((c) => c.type === 'Footer');
    expect(footer['on-click-action'].payload.step).toBe('to_picker');
  });

  it('keeps BRIEF terminal, completing with step "start"', () => {
    const footer = screen('BRIEF').layout.children.find((c) => c.type === 'Footer');
    expect(screen('BRIEF').terminal).toBe(true);
    expect(footer['on-click-action'].name).toBe('complete');
    expect(footer['on-click-action'].payload.step).toBe('start');
  });

  it('adds no cycle to the routing DAG', () => {
    const rm = flow.routing_model;
    const seen = new Set();
    const walk = (id, path) => {
      if (path.includes(id)) throw new Error(`cycle: ${[...path, id].join(' → ')}`);
      if (seen.has(id)) return;
      seen.add(id);
      for (const next of rm[id] || []) walk(next, [...path, id]);
    };
    expect(() => Object.keys(rm).forEach((id) => walk(id, []))).not.toThrow();
  });
});
