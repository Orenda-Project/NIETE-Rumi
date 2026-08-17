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
