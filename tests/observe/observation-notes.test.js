'use strict';
/**
 * bd-ra8xu.60 — Observation Notes: the switch and the store.
 *
 *   app_settings.observation_notes   'off' | 'on' per user / region / organization / "*", default OFF, 30 s cache
 *   analysis_data.observation_notes  [{ id, text, typed_at, rec_time, source, typed_before_review, batch }]
 *   analysis_data.observation_notes_review_opened_at   when the coach first opened Rumi's review form
 *
 * A note typed before the review form opens is the one coach signal not shaped by Rumi's pre-filled levels, so each
 * note carries typed_before_review, decided from the stored marker at the moment it is saved. The store is the
 * guarded read-modify-write of fico17-v6/late-write.js (patchSession), so a writer that got in between is never
 * overwritten. Supabase is mocked at the network boundary; the modules under test run for real.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));

const mockDb = { settings: [], settingsError: null, row: null, writes: [], users: {} };
jest.mock('../../bot/shared/config/supabase', () => {
  const make = (table) => {
    const q = { table, filters: [], patch: null };
    const b = {
      select: jest.fn(() => b),
      eq: jest.fn((k, v) => { q.filters.push([k, v]); return b; }),
      in: jest.fn(() => b),
      is: jest.fn((k, v) => { q.filters.push([k, v]); return b; }),
      not: jest.fn(() => b),
      update: jest.fn((patch) => { q.patch = patch; return b; }),
      maybeSingle: jest.fn(() => {
        if (table === 'users') return Promise.resolve({ data: mockDb.users, error: null });
        return Promise.resolve({ data: mockDb.row ? JSON.parse(JSON.stringify(mockDb.row)) : null, error: null });
      }),
      single: jest.fn(() => Promise.resolve({ data: mockDb.row, error: null })),
      then: (resolve) => {
        if (table === 'app_settings') return resolve({ data: mockDb.settings, error: mockDb.settingsError });
        if (q.patch && table === 'coaching_sessions') {
          const guard = q.filters.find(([k]) => k === 'updated_at');
          if (guard && mockDb.row && guard[1] !== mockDb.row.updated_at) return resolve({ data: [], error: null });
          mockDb.writes.push(q.patch);
          mockDb.row = { ...mockDb.row, ...q.patch, updated_at: `t${mockDb.writes.length}` };
          return resolve({ data: [{ id: mockDb.row.id }], error: null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return b;
  };
  return { from: jest.fn((t) => make(t)) };
});

const Switch = require('../../bot/shared/services/observe/observation-notes-switch');
const Notes = require('../../bot/shared/services/observe/observation-notes');

const NOW = new Date('2026-11-20T10:51:00.000Z');

beforeEach(() => {
  mockDb.settings = [];
  mockDb.settingsError = null;
  mockDb.writes = [];
  mockDb.users = { region: 'Sihala' };
  mockDb.row = { id: 's1', updated_at: 't0', analysis_data: { framework: 'fico17_v6', levels: {} } };
  Switch._resetCache();
});

describe('the observation_notes switch', () => {
  test('off by default: no row, an unknown value, a failed read', async () => {
    expect(await Switch.isOn('u1')).toBe(false);
    Switch._resetCache();
    mockDb.settings = [{ key: 'observation_notes', value: '{"user:u1": "maybe"}' }];
    expect(await Switch.isOn('u1')).toBe(false);
    Switch._resetCache();
    mockDb.settingsError = { message: 'down' };
    expect(await Switch.isOn('u1')).toBe(false);
  });

  test('on for a named account, a region, or everyone', async () => {
    mockDb.settings = [{ key: 'observation_notes', value: '{"user:u1": "on"}' }];
    expect(await Switch.isOn('u1')).toBe(true);
    expect(await Switch.isOn('u2')).toBe(false);
    Switch._resetCache();
    mockDb.settings = [{ key: 'observation_notes', value: '{"sihala": "on"}' }];
    expect(await Switch.isOn('u2')).toBe(true);
    Switch._resetCache();
    mockDb.settings = [{ key: 'observation_notes', value: '"on"' }];
    expect(await Switch.isOn('u3')).toBe(true);
    expect(await Switch.isOn(null)).toBe(false);
  });
});

describe('notesFromText', () => {
  test('one note per line, blank lines dropped, each capped at 600 code points', () => {
    const long = 'ب'.repeat(700);
    const out = Notes.notesFromText(`Board work: 5 children solved sums\n\n  back rows silent  \n${long}`, { source: 'whatsapp', now: NOW });
    expect(out.map((n) => n.text)).toEqual(['Board work: 5 children solved sums', 'back rows silent', 'ب'.repeat(600)]);
    expect(out[0]).toMatchObject({ source: 'whatsapp', typed_at: NOW.toISOString(), rec_time: null });
  });

  test('nothing typed is no notes', () => {
    expect(Notes.notesFromText('   \n ', { source: 'whatsapp', now: NOW })).toEqual([]);
    expect(Notes.notesFromText(undefined, { source: 'whatsapp', now: NOW })).toEqual([]);
  });
});

describe('fromClient (the portal)', () => {
  test('keeps text, the recording clock and where it was typed; drops junk; caps the count', () => {
    const raw = [
      { text: 'Board work: she asked each child how', rec_time: '12:40', source: 'portal_record', typed_at: '2026-11-20T10:27:00.000Z' },
      { text: 'Back rows silent', recTime: 1085, source: 'portal_record' },
      { text: '   ' },
      { text: 'Groups: one child did it all', source: 'somewhere_else' },
      'not an object',
    ];
    const out = Notes.fromClient(raw, { now: NOW });
    expect(out).toEqual([
      { text: 'Board work: she asked each child how', rec_time: '12:40', source: 'portal_record', typed_at: '2026-11-20T10:27:00.000Z' },
      { text: 'Back rows silent', rec_time: '18:05', source: 'portal_record', typed_at: NOW.toISOString() },
      { text: 'Groups: one child did it all', rec_time: null, source: 'portal_check', typed_at: NOW.toISOString() },
    ]);
    expect(Notes.fromClient(Array.from({ length: 80 }, (_, i) => ({ text: `n${i}` })), { now: NOW })).toHaveLength(Notes.MAX_NOTES);
  });
});

describe('addNotes', () => {
  test('appends with ids, the batch, and typed_before_review true while the review is unopened', async () => {
    const out = await Notes.addNotes('s1', Notes.notesFromText('a\nb', { source: 'whatsapp', now: NOW }), { batch: 'wa:1', quick: true });
    expect(out).toMatchObject({ ok: true, added: 2 });
    const stored = mockDb.row.analysis_data.observation_notes;
    expect(stored).toEqual([
      { id: 'n1', text: 'a', typed_at: NOW.toISOString(), rec_time: null, source: 'whatsapp', typed_before_review: true, batch: 'wa:1' },
      { id: 'n2', text: 'b', typed_at: NOW.toISOString(), rec_time: null, source: 'whatsapp', typed_before_review: true, batch: 'wa:1' },
    ]);
    // What else was on the row is kept.
    expect(mockDb.row.analysis_data.framework).toBe('fico17_v6');
  });

  test('the same batch twice (a webhook delivered again) adds nothing', async () => {
    const notes = Notes.notesFromText('a', { source: 'whatsapp', now: NOW });
    await Notes.addNotes('s1', notes, { batch: 'wa:1', quick: true });
    const again = await Notes.addNotes('s1', notes, { batch: 'wa:1', quick: true });
    expect(again).toMatchObject({ ok: true, added: 0 });
    expect(mockDb.row.analysis_data.observation_notes).toHaveLength(1);
  });

  test('after the review form was opened, new notes are flagged typed_before_review false; earlier ones keep true', async () => {
    await Notes.addNotes('s1', Notes.notesFromText('before', { source: 'whatsapp', now: NOW }), { batch: 'wa:1', quick: true });
    mockDb.row.analysis_data.observation_notes_review_opened_at = '2026-11-20T10:56:00.000Z';
    await Notes.addNotes('s1', Notes.notesFromText('after', { source: 'whatsapp', now: NOW }), { batch: 'wa:2', quick: true });
    const stored = mockDb.row.analysis_data.observation_notes;
    expect(stored.map((n) => [n.id, n.text, n.typed_before_review])).toEqual([['n1', 'before', true], ['n2', 'after', false]]);
  });

  test('a writer that got in between is not overwritten (the updated_at guard), and the notes still land', async () => {
    let first = true;
    const notes = Notes.notesFromText('a', { source: 'whatsapp', now: NOW });
    // Simulate another writer: bump updated_at and add a key right after the first read.
    const sb = require('../../bot/shared/config/supabase');
    const orig = sb.from.getMockImplementation();
    sb.from.mockImplementation((t) => {
      const b = orig(t);
      if (t === 'coaching_sessions' && first) {
        const ms = b.maybeSingle;
        b.maybeSingle = jest.fn(async () => {
          const r = await ms();
          first = false;
          mockDb.row = { ...mockDb.row, analysis_data: { ...mockDb.row.analysis_data, observer_debrief: { x: 1 } }, updated_at: 'tX' };
          return r;
        });
      }
      return b;
    });
    try {
      const out = await Notes.addNotes('s1', notes, { batch: 'wa:1', quick: true });
      expect(out.ok).toBe(true);
    } finally {
      sb.from.mockImplementation(orig);
    }
    expect(mockDb.row.analysis_data.observer_debrief).toEqual({ x: 1 });
    expect(mockDb.row.analysis_data.observation_notes).toHaveLength(1);
  });
});

describe('markReviewOpened', () => {
  test('stamps the first opening only', async () => {
    await Notes.markReviewOpened('s1', { now: NOW, quick: true });
    expect(mockDb.row.analysis_data.observation_notes_review_opened_at).toBe(NOW.toISOString());
    await Notes.markReviewOpened('s1', { now: new Date('2026-11-21T00:00:00Z'), quick: true });
    expect(mockDb.row.analysis_data.observation_notes_review_opened_at).toBe(NOW.toISOString());
  });
});

describe('carry', () => {
  test('the keys a whole-blob writer must carry over from a fresh read, and nothing else', () => {
    const fresh = {
      levels: { C1: {} },
      observation_notes: [{ id: 'n1', text: 'a' }],
      observation_notes_review_opened_at: 'x',
      dc_informed: { status: 'ok' },
    };
    expect(Notes.carry(fresh)).toEqual({
      observation_notes: [{ id: 'n1', text: 'a' }], observation_notes_review_opened_at: 'x', dc_informed: { status: 'ok' },
    });
    expect(Notes.carry({ levels: {} })).toEqual({});
    expect(Notes.carry(null)).toEqual({});
  });
});

describe('the review intro', () => {
  test('the notes, word for word, the recording clock first when there is one; Urdu digits in Urdu', () => {
    const analysis = { observation_notes: [
      { id: 'n1', text: 'Board work: 5 children', rec_time: '12:40' },
      { id: 'n2', text: 'Back rows silent', rec_time: null },
    ] };
    expect(Notes.introText(analysis, 'en')).toBe('12:40  Board work: 5 children\nBack rows silent');
    expect(Notes.introText(analysis, 'ur')).toBe('⁦۱۲:۴۰⁩  Board work: 5 children\nBack rows silent');
    expect(Notes.introText({}, 'en')).toBe('');
  });

  test('a long set is cut to fit one screen, and says so', () => {
    const analysis = { observation_notes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i + 1}`, text: 'x'.repeat(200) })) };
    const t = Notes.introText(analysis, 'en');
    expect(Array.from(t).length).toBeLessThanOrEqual(Notes.INTRO_CAP);
    expect(t.endsWith('…')).toBe(true);
  });
});
