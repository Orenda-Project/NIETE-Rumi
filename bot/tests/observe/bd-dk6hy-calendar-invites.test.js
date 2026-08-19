/**
 * bd-dk6hy — calendar invites for scheduled observations. TDD, red-first.
 *
 * A coach schedules a visit in WhatsApp and then has to remember it. The invite
 * puts it where the rest of her week already is.
 *
 * THREE PROPERTIES THIS FILE EXISTS TO PIN
 * ---------------------------------------
 * 1. **The invite is never allowed to break the scheduling.** Scheduling is the
 *    product; the invite is a courtesy on top of it. Every calendar call is
 *    best-effort and non-blocking — an expired token, a 403, a network stall
 *    must leave the coach with her visit saved and no exception in sight. This
 *    is the same discipline markDone already keeps.
 * 2. **No row in coach_directory means no invite, silently.** We refuse to guess
 *    an address from a name (bd-o98ji): one wrong guess puts a school visit on a
 *    stranger's calendar.
 * 3. **The coach only.** Teachers are not invited and are not attendees — they
 *    have phones, not email. Not "for visibility" either (operator, 19 Aug).
 *
 * The Google transport is mocked throughout: this suite proves WHICH call is
 * made with WHICH arguments, never that Google works.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

jest.mock('../../shared/services/observe/google-calendar.client', () => ({
  insertEvent: jest.fn().mockResolvedValue({ id: 'evt-new' }),
  patchEvent: jest.fn().mockResolvedValue({ id: 'evt-1' }),
  deleteEvent: jest.fn().mockResolvedValue(true),
  isConfigured: jest.fn().mockReturnValue(true),
}));

const google = require('../../shared/services/observe/google-calendar.client');

// coach_directory + observation_schedules, both answerable per test.
const db = { directory: {}, schedulePatches: [] };
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    if (table === 'coach_directory') {
      let wanted = null;
      const chain = {
        select: () => chain,
        eq: (_c, v) => { wanted = v; return chain; },
        maybeSingle: async () => ({ data: db.directory[wanted] || null, error: null }),
      };
      return chain;
    }
    if (table === 'observation_schedules') {
      const chain = {
        update: (patch) => { db.schedulePatches.push(patch); return chain; },
        select: () => chain,
        eq: () => chain,
        then: undefined,
      };
      // terminal await on the update chain
      chain.eq = () => Object.assign(chain, { then: (r) => r({ data: [{ id: 'sch-1' }], error: null }) });
      return chain;
    }
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
  }),
}));

const Calendar = require('../../shared/services/observe/observe-calendar.service');

const COACH = 'coach-1';
const schedule = (over = {}) => ({
  id: 'sch-1',
  leader_user_id: COACH,
  teacher_name: 'A Teacher',
  school_name: 'A School',
  scheduled_for: '2026-09-01',
  scheduled_slot: '09:30',
  calendar_event_id: null,
  ...over,
});

const enable = (v) => { process.env.OBSERVE_CALENDAR_ENABLED = v; };

beforeEach(() => {
  jest.clearAllMocks();
  db.directory = { [COACH]: { work_email: 'a.coach@example.edu', full_name: 'A Coach' } };
  db.schedulePatches = [];
  delete process.env.OBSERVE_CALENDAR_ENABLED;
  google.isConfigured.mockReturnValue(true);
  google.insertEvent.mockResolvedValue({ id: 'evt-new' });
  google.patchEvent.mockResolvedValue({ id: 'evt-1' });
  google.deleteEvent.mockResolvedValue(true);
});

describe('bd-dk6hy — the flag is off until it is on', () => {
  it('makes zero calendar calls when the flag is unset', async () => {
    await Calendar.onScheduled(schedule());
    await Calendar.onRescheduled(schedule({ calendar_event_id: 'evt-1' }));
    await Calendar.onCancelled(schedule({ calendar_event_id: 'evt-1' }));
    expect(google.insertEvent).not.toHaveBeenCalled();
    expect(google.patchEvent).not.toHaveBeenCalled();
    expect(google.deleteEvent).not.toHaveBeenCalled();
  });

  it('makes zero calls when the flag is explicitly false', async () => {
    enable('false');
    await Calendar.onScheduled(schedule());
    expect(google.insertEvent).not.toHaveBeenCalled();
  });

  it('rolls out to a named set before everyone — a coach outside it gets nothing', async () => {
    enable('coach-2,coach-3');
    db.directory['coach-2'] = { work_email: 'b.coach@example.edu', full_name: 'B Coach' };
    await Calendar.onScheduled(schedule());
    expect(google.insertEvent).not.toHaveBeenCalled();

    await Calendar.onScheduled(schedule({ leader_user_id: 'coach-2' }));
    expect(google.insertEvent).toHaveBeenCalledTimes(1);
  });

  it('makes zero calls when the flag is on but Google is not configured', async () => {
    enable('true');
    google.isConfigured.mockReturnValue(false);
    await Calendar.onScheduled(schedule());
    expect(google.insertEvent).not.toHaveBeenCalled();
  });
});

describe('bd-dk6hy — creating the invite', () => {
  beforeEach(() => enable('true'));

  it('invites the COACH, and only the coach', async () => {
    await Calendar.onScheduled(schedule());
    const [event] = google.insertEvent.mock.calls[0];
    expect(event.attendees).toEqual([{ email: 'a.coach@example.edu' }]);
  });

  it('names the teacher and the school, so the entry is readable at a glance', async () => {
    await Calendar.onScheduled(schedule());
    const [event] = google.insertEvent.mock.calls[0];
    expect(event.summary).toContain('A Teacher');
    expect(event.summary).toContain('A School');
  });

  it('carries the brief link in the description when the portal is configured', async () => {
    const prev = process.env.PORTAL_URL;
    process.env.PORTAL_URL = 'https://portal.example.org/';
    try {
      await Calendar.onScheduled(schedule());
      const [event] = google.insertEvent.mock.calls[0];
      expect(event.description).toContain('https://portal.example.org/portal/leader/observations');
    } finally {
      if (prev === undefined) delete process.env.PORTAL_URL; else process.env.PORTAL_URL = prev;
    }
  });

  it('omits the link rather than shipping a placeholder when the portal is unset', async () => {
    const prev = process.env.PORTAL_URL;
    delete process.env.PORTAL_URL;
    try {
      await Calendar.onScheduled(schedule());
      const [event] = google.insertEvent.mock.calls[0];
      expect(event.description || '').not.toMatch(/undefined|null|http/);
    } finally {
      if (prev !== undefined) process.env.PORTAL_URL = prev;
    }
  });

  it('books the slot she picked', async () => {
    await Calendar.onScheduled(schedule({ scheduled_slot: '09:30' }));
    const [event] = google.insertEvent.mock.calls[0];
    expect(event.start.dateTime).toBe('2026-09-01T09:30:00');
    expect(event.end.dateTime).toBe('2026-09-01T10:30:00');
  });

  it('falls back to an all-day entry when she picked no slot', async () => {
    // Better than inventing a time she did not choose: the day is the fact.
    await Calendar.onScheduled(schedule({ scheduled_slot: null }));
    const [event] = google.insertEvent.mock.calls[0];
    expect(event.start.date).toBe('2026-09-01');
    expect(event.start.dateTime).toBeUndefined();
  });

  it('stores the event id so a later move can address the same event', async () => {
    await Calendar.onScheduled(schedule());
    expect(db.schedulePatches.some((p) => p.calendar_event_id === 'evt-new')).toBe(true);
  });

  it('skips a coach with no directory row, silently and without guessing', async () => {
    db.directory = {};
    await expect(Calendar.onScheduled(schedule())).resolves.toBeUndefined();
    expect(google.insertEvent).not.toHaveBeenCalled();
  });
});

describe('bd-dk6hy — moving and cancelling address the SAME event', () => {
  beforeEach(() => enable('true'));

  it('patches the event the schedule already carries', async () => {
    await Calendar.onRescheduled(schedule({ calendar_event_id: 'evt-1', scheduled_for: '2026-09-08' }));
    expect(google.patchEvent).toHaveBeenCalledTimes(1);
    const [eventId, patch] = google.patchEvent.mock.calls[0];
    expect(eventId).toBe('evt-1');
    expect(patch.start.dateTime).toBe('2026-09-08T09:30:00');
  });

  it('creates one instead when the schedule never had an event', async () => {
    // A visit scheduled before the flag was on, moved after. Patching nothing
    // would silently drop the invite forever.
    await Calendar.onRescheduled(schedule({ calendar_event_id: null }));
    expect(google.patchEvent).not.toHaveBeenCalled();
    expect(google.insertEvent).toHaveBeenCalledTimes(1);
  });

  it('deletes the event the schedule carries', async () => {
    await Calendar.onCancelled(schedule({ calendar_event_id: 'evt-1' }));
    expect(google.deleteEvent).toHaveBeenCalledWith('evt-1');
  });

  it('clears the stored id on cancel, so a double-cancel is a no-op', async () => {
    await Calendar.onCancelled(schedule({ calendar_event_id: 'evt-1' }));
    expect(db.schedulePatches.some((p) => p.calendar_event_id === null)).toBe(true);
  });

  it('does not throw on a double-cancel', async () => {
    await Calendar.onCancelled(schedule({ calendar_event_id: 'evt-1' }));
    jest.clearAllMocks();
    await expect(Calendar.onCancelled(schedule({ calendar_event_id: null }))).resolves.toBeUndefined();
    expect(google.deleteEvent).not.toHaveBeenCalled();
  });
});

describe('bd-dk6hy — a calendar failure never reaches the coach', () => {
  beforeEach(() => enable('true'));

  it('swallows an API error on create', async () => {
    google.insertEvent.mockRejectedValue(new Error('403 insufficient permissions'));
    await expect(Calendar.onScheduled(schedule())).resolves.toBeUndefined();
  });

  it('swallows an API error on patch', async () => {
    google.patchEvent.mockRejectedValue(new Error('404 not found'));
    await expect(Calendar.onRescheduled(schedule({ calendar_event_id: 'evt-1' })))
      .resolves.toBeUndefined();
  });

  it('swallows an API error on delete — an already-deleted event is fine', async () => {
    google.deleteEvent.mockRejectedValue(new Error('410 gone'));
    await expect(Calendar.onCancelled(schedule({ calendar_event_id: 'evt-1' })))
      .resolves.toBeUndefined();
  });

  it('swallows a directory lookup failure', async () => {
    const supabase = require('../../shared/config/supabase');
    supabase.from.mockImplementationOnce(() => { throw new Error('db down'); });
    await expect(Calendar.onScheduled(schedule())).resolves.toBeUndefined();
  });
});
