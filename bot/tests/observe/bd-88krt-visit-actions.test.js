/**
 * bd-88krt — WhatsApp Flow: teacher search, and act on a scheduled visit (TDD).
 *
 * Riffat, HITL R37/R39. Meta research (developers.facebook.com, Flow JSON v7.0):
 *   · Dropdown holds 200 options (100 with images) and has NO built-in search
 *     or filter field, and there is no searchable-list component. The documented
 *     way to search is TextInput -> data_exchange -> server-filtered options.
 *     That is why SEARCH_TEACHER exists at all.
 *   · RadioButtonsGroup caps at 20 options — so it is both the action bar and
 *     the ceiling on how many search matches a screen can render.
 *   · routing_model is FORWARD-ONLY: a cycle fails publish, which is why search
 *     sits BEFORE the picker (SELECT_SCHOOL -> SEARCH_TEACHER -> SELECT_TEACHER)
 *     rather than hanging off it.
 *
 * These are the pure decisions; the DB glue around them stays thin.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const {
  filterTeachersByTerm, visitActionTarget, visitSummary, TEACHER_MATCH_CAP,
} = require('../../shared/handlers/observe-visit-flow.handler');

const T = (name, extra = {}) => ({
  teacher_name: name,
  teacher_ext_id: String(name || 'unnamed').toLowerCase().replace(/\s+/g, '-'),
  ...extra,
});

describe('bd-88krt · teacher search (the TextInput path)', () => {
  const roster = [T('Tahira Manzoor'), T('Touseef Ahmed'), T('Nafeesa Noor'), T('tahira bibi'), T(null)];

  it('matches on part of the name, case-insensitively', () => {
    const out = filterTeachersByTerm(roster, 'tahira');
    expect(out.map((t) => t.teacher_name)).toEqual(['Tahira Manzoor', 'tahira bibi']);
  });

  it('matches mid-name, not just the start', () => {
    expect(filterTeachersByTerm(roster, 'noor').map((t) => t.teacher_name)).toEqual(['Nafeesa Noor']);
  });

  it('a blank term returns everyone — a coach with 5 teachers should not have to type', () => {
    expect(filterTeachersByTerm(roster, '')).toHaveLength(roster.length);
    expect(filterTeachersByTerm(roster, null)).toHaveLength(roster.length);
    expect(filterTeachersByTerm(roster, '   ')).toHaveLength(roster.length);
  });

  it('never throws on a teacher with no name', () => {
    expect(() => filterTeachersByTerm(roster, 'x')).not.toThrow();
    expect(filterTeachersByTerm(roster, 'x')).toEqual([]);
  });

  it('caps matches at the RadioButtonsGroup ceiling so the screen can always render', () => {
    const many = Array.from({ length: 300 }, (_, i) => T(`Teacher ${i}`));
    expect(filterTeachersByTerm(many, 'teacher').length).toBeLessThanOrEqual(TEACHER_MATCH_CAP);
    expect(TEACHER_MATCH_CAP).toBeLessThanOrEqual(20);
  });

  it('trims the term — a trailing space must not lose every match', () => {
    expect(filterTeachersByTerm(roster, ' tahira ')).toHaveLength(2);
  });
});

describe('bd-88krt · the three-option action bar', () => {
  it('routes each choice to the screen the routing_model allows', () => {
    expect(visitActionTarget('run')).toBe('BRIEF');
    expect(visitActionTarget('reschedule')).toBe('SCHEDULE_EDIT');
    expect(visitActionTarget('cancel')).toBe('CANCEL');
  });

  it('falls back to running the observation on anything unexpected', () => {
    // A stale Flow client sending an unknown value must not dead-end the coach.
    for (const bad of ['', null, undefined, 'delete', 'RUN']) {
      expect(visitActionTarget(bad)).toBe('BRIEF');
    }
  });
});

describe('bd-88krt · the visit summary line', () => {
  it('names the teacher, the school and when', () => {
    const s = visitSummary({ teacher_name: 'Abid Ullah', school_name: 'IMCB Bhara Kau', scheduled_for: '2026-08-20', scheduled_slot: '09:00' });
    expect(s).toContain('Abid Ullah');
    expect(s).toContain('IMCB Bhara Kau');
    expect(s).toContain('2026-08-20');
    expect(s).toContain('09:00');
  });

  it('omits what it does not know instead of printing null', () => {
    const s = visitSummary({ teacher_name: null, school_name: null, scheduled_for: '2026-08-20', scheduled_slot: null });
    expect(s).not.toMatch(/null|undefined/);
    expect(s).toContain('2026-08-20');
  });

  it('never exceeds what a TextSubheading will show', () => {
    const s = visitSummary({
      teacher_name: 'A'.repeat(120), school_name: 'B'.repeat(120),
      scheduled_for: '2026-08-20', scheduled_slot: '09:00',
    });
    expect(s.length).toBeLessThanOrEqual(80);
  });
});

/**
 * Regression for the "Something went wrong" I shipped to staging at 16:35.
 * Meta reported: payload-schema-error, "Required [key=data.school_ext_id] in
 * Data model should be present in 3P data" — I had declared school_ext_id on
 * SELECT_SCHOOL to feed the search link, but the endpoint never sends it. Every
 * key a screen DECLARES must appear in the endpoint's data, so the contract is
 * asserted here against the published JSON itself.
 */
describe('bd-88krt · the Flow data contract matches what the server sends', () => {
  const flow = require('../../../docs/flows/observe-visit-v2.json');
  const byId = Object.fromEntries(flow.screens.map((s) => [s.id, s]));

  it('SELECT_SCHOOL declares only what schoolsScreenV2 returns', () => {
    expect(Object.keys(byId.SELECT_SCHOOL.data || {})).toEqual(['options']);
  });

  it('SEARCH_TEACHER declares nothing, because it needs nothing', () => {
    expect(Object.keys(byId.SEARCH_TEACHER.data || {})).toEqual([]);
  });

  it('the search link carries an empty payload — there is no school chosen yet', () => {
    const link = byId.SELECT_SCHOOL.layout.children.find((c) => c.type === 'EmbeddedLink');
    expect(link).toBeTruthy();
    expect(link['on-click-action'].payload).toEqual({});
    expect(link['on-click-action'].next.name).toBe('SEARCH_TEACHER');
  });

  it('every screen the routing model names actually exists', () => {
    for (const [from, tos] of Object.entries(flow.routing_model)) {
      expect(byId[from]).toBeTruthy();
      for (const to of tos) expect(byId[to]).toBeTruthy();
    }
  });

  it('routing is forward-only — a cycle fails publish outright', () => {
    for (const [from, tos] of Object.entries(flow.routing_model)) {
      expect(tos).not.toContain(from);                       // no self-route
      for (const to of tos) {
        expect(flow.routing_model[to] || []).not.toContain(from);   // no 2-cycle
      }
    }
  });
});
