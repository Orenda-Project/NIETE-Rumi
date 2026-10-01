/**
 * bd-xorfy — the teacher hears about her own observation visit. TDD, red-first.
 *
 * A coach books, moves or cancels a visit (WhatsApp /observe or the portal) and
 * the teacher gets a WhatsApp template with the date and time, so she knows
 * before the coach walks in.
 *
 * What this file pins is the NOTICE: which template, which language, which
 * parameters, and the guards that stop it — flag off, a teacher with no phone,
 * a failed send. The lifecycle wiring is bd-xorfy-schedule-notice-wiring.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendTemplate: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../shared/services/observe/observe-framework', () => ({
  getObservePack: () => ({ key: 'fico' }),
}));

// users stand-in: keyed by the column the service filters on.
const people = { byPhone: {}, byId: {} };
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => {
    const filter = {};
    const chain = {
      select: () => chain,
      eq: (col, val) => { filter[col] = val; return chain; },
      maybeSingle: async () => {
        const row = filter.phone_number !== undefined
          ? people.byPhone[filter.phone_number]
          : people.byId[filter.id];
        return { data: row || null, error: null };
      },
    };
    return chain;
  }),
}));

const WhatsApp = require('../../shared/services/whatsapp.service');
const Notice = require('../../shared/services/observe/observe-teacher-notice.service');
const { TEMPLATES } = require('../../shared/templates/observe-visit-notice.template');

const row = (over = {}) => ({
  id: 'sch-1',
  leader_user_id: 'coach-1',
  teacher_ext_id: '923001234567',
  teacher_name: 'Ayesha Khan',
  school_name: 'IMSG I-8/1',
  scheduled_for: '2026-10-08',
  scheduled_slot: '09:30',
  status: 'upcoming',
  ...over,
});

const params = () => {
  const [, , , components] = WhatsApp.sendTemplate.mock.calls[0];
  return components[0].parameters.map((p) => p.text);
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OBSERVE_TEACHER_NOTIFY_ENABLED = 'true';
  people.byPhone = {
    '923001234567': { name: 'Ayesha Khan', preferred_language: 'en' },
  };
  people.byId = { 'coach-1': { name: 'Sana Iqbal' } };
});

afterAll(() => { delete process.env.OBSERVE_TEACHER_NOTIFY_ENABLED; });

describe('bd-xorfy — the notice itself', () => {
  it('a booking sends the scheduled template to the teacher\'s phone', async () => {
    const sent = await Notice.notifyTeacher('scheduled', row());
    expect(sent).toBe(true);
    expect(WhatsApp.sendTemplate).toHaveBeenCalledTimes(1);
    const [to, name, lang] = WhatsApp.sendTemplate.mock.calls[0];
    expect(to).toBe('923001234567');
    expect(name).toBe(TEMPLATES.scheduled.name);
    // Meta locale code, not the registry code: an en_US template will not match 'en'.
    expect(lang).toBe('en_US');
  });

  it('carries teacher, coach, school, date and time — in that order', async () => {
    await Notice.notifyTeacher('scheduled', row());
    expect(params()).toEqual([
      'Ayesha Khan', 'Sana Iqbal', 'IMSG I-8/1', 'Thursday, 8 October 2026', '9:30 AM',
    ]);
  });

  it('an Urdu teacher gets the Urdu template with an Urdu date and time', async () => {
    people.byPhone['923001234567'].preferred_language = 'ur';
    await Notice.notifyTeacher('scheduled', row({ scheduled_slot: '13:00' }));
    const [, , lang] = WhatsApp.sendTemplate.mock.calls[0];
    expect(lang).toBe('ur');
    const p = params();
    expect(p[3]).toBe('جمعرات، 8 اکتوبر 2026');
    expect(p[4]).toBe('دوپہر 1:00');
  });

  it('no stated preference falls to the market default (Urdu for ICT), never English by accident', async () => {
    people.byPhone['923001234567'].preferred_language = null;
    await Notice.notifyTeacher('scheduled', row());
    expect(WhatsApp.sendTemplate.mock.calls[0][2]).toBe('ur');
  });

  it('a visit with no slot says the time is to be confirmed — never an empty parameter', async () => {
    await Notice.notifyTeacher('scheduled', row({ scheduled_slot: null }));
    expect(params()[4]).toBe('To be confirmed by your coach');
  });

  it('a move and a cancel use their own templates', async () => {
    await Notice.notifyTeacher('rescheduled', row());
    await Notice.notifyTeacher('cancelled', row());
    expect(WhatsApp.sendTemplate.mock.calls[0][1]).toBe(TEMPLATES.rescheduled.name);
    expect(WhatsApp.sendTemplate.mock.calls[1][1]).toBe(TEMPLATES.cancelled.name);
  });

  it('a coach with no name on file is "Your coach", not a blank Meta will reject', async () => {
    people.byId = {};
    await Notice.notifyTeacher('scheduled', row());
    expect(params()[1]).toBe('Your coach');
  });

  it('the teacher name falls back to the schedule row when she has no users row', async () => {
    people.byPhone = {};
    await Notice.notifyTeacher('scheduled', row());
    expect(params()[0]).toBe('Ayesha Khan');
  });
});

describe('bd-xorfy — the guards', () => {
  it('flag unset → dormant, zero sends', async () => {
    delete process.env.OBSERVE_TEACHER_NOTIFY_ENABLED;
    expect(await Notice.notifyTeacher('scheduled', row())).toBe(false);
    expect(WhatsApp.sendTemplate).not.toHaveBeenCalled();
  });

  it('flag as a coach allow-list only notifies those coaches\' teachers', async () => {
    process.env.OBSERVE_TEACHER_NOTIFY_ENABLED = 'coach-2, coach-3';
    expect(await Notice.notifyTeacher('scheduled', row())).toBe(false);
    process.env.OBSERVE_TEACHER_NOTIFY_ENABLED = 'coach-2,coach-1';
    expect(await Notice.notifyTeacher('scheduled', row())).toBe(true);
  });

  it('an off-Rumi teacher keyed by a name slug has no phone — nothing is sent', async () => {
    expect(await Notice.notifyTeacher('scheduled', row({ teacher_ext_id: 'ayesha-khan' }))).toBe(false);
    expect(WhatsApp.sendTemplate).not.toHaveBeenCalled();
  });

  it('an unknown kind sends nothing', async () => {
    expect(await Notice.notifyTeacher('bogus', row())).toBe(false);
    expect(WhatsApp.sendTemplate).not.toHaveBeenCalled();
  });

  it('a failed or throwing send never throws out of the notice', async () => {
    WhatsApp.sendTemplate.mockRejectedValueOnce(new Error('graph down'));
    await expect(Notice.notifyTeacher('scheduled', row())).resolves.toBe(false);
  });
});

describe('bd-xorfy — the templates fit Meta\'s rules', () => {
  const kinds = ['scheduled', 'rescheduled', 'cancelled'];
  it.each(kinds)('%s has an en_US and an ur body with exactly {{1}}..{{5}}', (kind) => {
    const t = TEMPLATES[kind];
    for (const lang of ['en_US', 'ur']) {
      const body = t.bodies[lang];
      expect(typeof body).toBe('string');
      const vars = (body.match(/\{\{\d+\}\}/g) || []).sort();
      expect(vars).toEqual(['{{1}}', '{{2}}', '{{3}}', '{{4}}', '{{5}}']);
      expect([...body].length).toBeLessThanOrEqual(1024);
      // Meta rejects a body that starts or ends on a variable.
      expect(body.trim()).not.toMatch(/^\{\{|\}\}$/);
    }
  });
});
