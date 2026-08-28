/**
 * bd-51wpo / bd-k3w4l / bd-ve7kd — loops, bulk add, and honest interstitials.
 *
 * Operator on staging, 17 Aug, three reports in one message:
 *   · "Couldn't load content. Try again later." adding a 57-teacher school,
 *     which then worked on the second try.
 *   · after adding, the chat said "Thanks for your response".
 *   · no way to add/remove another school or get back to the main menu.
 *
 * MEASURED, not assumed (staging, 8 samples): a PostgREST round-trip is ~160ms
 * and addSchoolForCoach did ONE INSERT PER TEACHER. 57 teachers + 6 fixed
 * queries ≈ 10.1s against Meta's ~10s data_exchange timeout — hence the coin
 * flip, and hence the instant success on retry (that path returns in ~1s). The
 * largest NIETE school, 160 teachers, would take ~27s and could never succeed.
 *
 * VERIFIED AGAINST META (throwaway flow on the staging WABA, not memory):
 *   · EmbeddedLink cannot `complete` — "Value should be one of: [data_exchange,
 *     navigate, open_url]". Only a Footer ends a Flow.
 *   · "Maximum number of Footer allowed per screen is 1 but found 2."
 *   · "Backward route [S->MENU] ... is not allowed."
 * Together those three make "Main menu on EVERY screen" unbuildable: a mid-flow
 * screen has spent its one Footer on its own action, and a link back to MENU is
 * a cycle. So the loop lives on the step-END screens, where the Footer is free
 * to be a chooser, and it works by completing the Flow and reopening it.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const { rosterNextTarget, ROSTER_NEXT } = require('../../shared/services/observe/observe-school-admin.service');

describe('bd-ve7kd · where each loop choice sends the coach', () => {
  it('add another -> straight back to the school search', () => {
    expect(rosterNextTarget('add')).toEqual({ reopen: true, screen: 'ADD_SEARCH' });
  });

  it('remove another -> her own school list', () => {
    expect(rosterNextTarget('remove')).toEqual({ reopen: true, screen: 'MANAGE_SCHOOLS' });
  });

  it('main menu -> reopened with no screen, so the endpoint serves a fresh MENU', () => {
    // MENU declares `items`, which only the endpoint can supply — reopening in
    // navigate mode would hand the client a screen whose data it doesn't have.
    expect(rosterNextTarget('menu')).toEqual({ reopen: true, screen: null });
  });

  it("I'm done -> nothing is sent; the screen already confirmed it", () => {
    expect(rosterNextTarget('done')).toEqual({ reopen: false, screen: null });
  });

  it('anything unexpected ends quietly rather than looping forever', () => {
    for (const bad of ['', null, undefined, 'MENU', 'restart']) {
      expect(rosterNextTarget(bad)).toEqual({ reopen: false, screen: null });
    }
  });

  it('exposes the option ids the Flow renders, so the two cannot drift apart', () => {
    expect(ROSTER_NEXT).toEqual(['add', 'remove', 'menu', 'done']);
  });
});

describe('bd-ve7kd · the Flow honours the limits Meta enforces', () => {
  const flow = require('../../../docs/flows/observe-visit-v2.json');
  const byId = Object.fromEntries(flow.screens.map((s) => [s.id, s]));
  const comps = (sid) => {
    const out = [];
    (function walk(ch) { for (const c of ch || []) { out.push(c); walk(c.children); } })(byId[sid].layout.children);
    return out;
  };

  it('no screen carries two Footers — Meta rejects the upload outright', () => {
    for (const s of flow.screens) {
      expect(comps(s.id).filter((c) => c.type === 'Footer').length).toBeLessThanOrEqual(1);
    }
  });

  it('no EmbeddedLink tries to complete the flow — links cannot', () => {
    for (const s of flow.screens) {
      for (const c of comps(s.id)) {
        if (c.type === 'EmbeddedLink') expect(c['on-click-action'].name).not.toBe('complete');
      }
    }
  });

  it('routing is a DAG — any cycle, not just a 2-cycle, fails publish', () => {
    const seen = {};
    const walk = (n, stack) => {
      if (stack.includes(n)) throw new Error(`cycle: ${stack.join(' -> ')} -> ${n}`);
      if (seen[n]) return;
      seen[n] = 1;
      for (const next of flow.routing_model[n] || []) walk(next, [...stack, n]);
    };
    expect(() => Object.keys(flow.routing_model).forEach((n) => walk(n, []))).not.toThrow();
  });

  it('the after-add screen offers the loop, and completes with the choice', () => {
    const radio = comps('ACTION_DONE').find((c) => c.type === 'RadioButtonsGroup');
    expect(radio).toBeTruthy();
    expect(radio['data-source'].map((o) => o.id)).toEqual(ROSTER_NEXT);
    const f = comps('ACTION_DONE').find((c) => c.type === 'Footer');
    expect(f['on-click-action'].name).toBe('complete');
    // The Footer payload IS the response — the pattern BRIEF already uses to
    // start observations in production. Do not rely on extension_message_response.
    expect(f['on-click-action'].payload.roster_next).toBe('${form.next}');
    expect(f['on-click-action'].payload.observe_visit_action).toBe('roster');
  });

  it('the after-schedule screen loops too, and still carries its ack fields', () => {
    const f = comps('SUCCESS').find((c) => c.type === 'Footer');
    const p = f['on-click-action'].payload;
    expect(f['on-click-action'].name).toBe('complete');
    expect(p.visit_next).toBe('${form.next}');
    // Cancel/reschedule acks must survive the change to a payload-driven exit.
    expect(p.observe_visit_action).toBe('${data.action}');
    expect(p.teacher_name).toBe('${data.teacher_name}');
  });

  it('every key a screen declares can be filled by the endpoint or the client', () => {
    for (const s of flow.screens) {
      for (const k of Object.keys(s.data || {})) {
        expect(typeof k).toBe('string');
        expect(s.data[k]).toHaveProperty('__example__');   // a declared key with no example fails at runtime
      }
    }
  });
});

describe('bd-51wpo · adding a school is ONE write, not one per teacher', () => {
  let inserts;
  const ROSTER = Array.from({ length: 57 }, (_, i) => ({
    teacher_ext_id: `t${i}`, teacher_name: `T${i}`, teacher_phone_e164: `9230000${String(i).padStart(4, '0')}`,
  }));
  // The filters matter: leader_teachers answers "do I already hold this school?"
  // (scoped by leader_user_id -> none) AND "who teaches here?" (scoped by
  // school_ext_id only -> 57). A mock that ignores eq() makes the code take the
  // already-mine path and looks like a missing insert.
  const mockDb = () => {
    inserts = [];
    const result = (table, filters) => {
      if (table === 'leader_schools') {
        // Same filter-awareness the leader_teachers branch already has:
        // scoped by leader_user_id it answers "do I hold this?" (no), scoped by
        // school_ext_id alone it answers "what school is this?" (the record).
        return filters.leader_user_id
          ? { data: [], error: null }
          : { data: [{ school_name: 'IMCB, I-8/3', emis: '910' }], error: null };
      }
      if (table === 'schools') return { data: [], error: null };
      if (table === 'leader_teachers') {
        return filters.leader_user_id ? { data: [], error: null, count: 57 } : { data: ROSTER, error: null };
      }
      return { data: [], error: null };
    };
    const q = (table) => {
      const filters = {};
      const self = {
        select: () => self, limit: () => self, delete: () => self,
        eq: (col, val) => { filters[col] = val; return self; },
        // The real client returns a builder, so .insert().select().limit() is
        // valid — resolveOrCreateSchool uses it to read back a created school.
        insert: (payload) => {
          inserts.push({ table, payload });
          const made = { id: `new-${table}-id`, ...payload };
          const ins = {
            select: () => ins, limit: () => ins,
            then: (res) => res({ data: [made], error: null }),
          };
          return ins;
        },
        then: (res) => res(result(table, filters)),
      };
      return self;
    };
    return { from: q };
  };

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../shared/config/supabase', () => mockDb(), { virtual: true });
  });
  afterEach(() => jest.dontMock('../../shared/config/supabase'));

  it('materialises the school into the master, then links it by id', async () => {
    // A school known only to leader_schools can never have anyone derived into
    // it — users.school_id has nothing to point at. So the add creates the
    // master row and the assignment carries the real foreign key.
    const svc = require('../../shared/services/observe/observe-school-admin.service');
    await svc.addSchoolForCoach('coach-1', 'niete:910');
    const schoolInsert = inserts.find((i) => i.table === 'schools');
    expect(schoolInsert.payload).toMatchObject({ name: 'IMCB, I-8/3', emis: '910' });
    const assignment = inserts.find((i) => i.table === 'leader_schools');
    expect(assignment.payload.school_id).toBe('new-schools-id');
  });

  it('writes the whole roster in a single insert call', async () => {
    const svc = require('../../shared/services/observe/observe-school-admin.service');
    await svc.addSchoolForCoach('coach-1', 'niete:910');
    const teacherInserts = inserts.filter((i) => i.table === 'leader_teachers');
    // 57 sequential inserts is ~10.1s and loses the race with Meta's timeout.
    expect(teacherInserts).toHaveLength(1);
    expect(Array.isArray(teacherInserts[0].payload)).toBe(true);
    expect(teacherInserts[0].payload.length).toBe(57);
  });

  it('keeps the source value the CHECK constraint permits on every row', async () => {
    const svc = require('../../shared/services/observe/observe-school-admin.service');
    await svc.addSchoolForCoach('coach-1', 'niete:910');
    const rows = inserts.filter((i) => i.table === 'leader_teachers')[0].payload;
    expect(rows.every((r) => r.source === 'niete_ict')).toBe(true);
  });
});

describe('bd-k3w4l · the interstitials say what actually happened', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../shared/handlers/flow-response.handler.js'), 'utf8');

  it("adding or removing a school never falls into the 'record the lesson' prompt", () => {
    const iRoster = src.indexOf("visitAction === 'roster'");
    const iFall = src.indexOf('buildVisitCapturePrompt(observeLang');
    expect(iRoster).toBeGreaterThan(-1);
    expect(iRoster).toBeLessThan(iFall);      // must return before the fall-through
  });

  it('sends no second chat message for a roster action — the screen already said it', () => {
    const branch = src.slice(src.indexOf("visitAction === 'roster'"), src.indexOf("visitAction === 'cancelled'"));
    expect(branch).not.toMatch(/sendMessage/);
  });

  it('closes the loop from every step-end, not just the roster one', () => {
    // schedule / cancel / reschedule all end on SUCCESS and all offer the loop.
    expect((src.match(/_continueObserveLoop\(/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it('a failed reopen is swallowed — the coach is never left mid-loop with an error', () => {
    const fn = src.slice(src.indexOf('async function _continueObserveLoop'));
    expect(fn.slice(0, 2200)).toMatch(/catch \(err\)/);
  });
});
